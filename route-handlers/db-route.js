const express = require('express');
const knex = require('../db.js');
const googleCalls = require('../utilities/google');
const cloudinary = require('cloudinary');

const path = 'route';

const app = express();

app.use(express.json({ limit: '5mb' }));

cloudinary.config({
  cloud_name: 'honeybadgerhackers',
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

/* eslint-disable no-param-reassign */
app.get(`/${path}&location`, (req, res) => {
  const filter = req.headers.filter ? JSON.parse(req.headers.filter) : {};
  knex(path)
    .where(filter)
    .join('waypoint', 'route.id', '=', 'waypoint.id_route')
    .select(
      'route.id', 'route.route_name', 'route.type', 'route.current_rating',
      'route.favorite_count', 'waypoint.lat', 'waypoint.lng', 'waypoint.count',
    )
    .then((results) => {
      const waypoints = results.map(result => ({
        lat: result.lat,
        lng: result.lng,
        count: result.count,
      }));
      delete results[0].lat;
      delete results[0].lng;
      results[0].waypoints = waypoints;
      const mergedRoute = results[0];
      res.send(mergedRoute);
    })
    .catch((error) => {
      // eslint-disable-next-line
      console.log(error);
    });
});

app.get(`/${path}`, (req, res) => {
  const filter = req.headers.filter ? JSON.parse(req.headers.filter) : {};
  knex(path)
    .where(filter)
    .select()
    .then((results) => {
      res.send(results);
    });
});

/*
`SELECT *, ( 3959 * acos( cos( radians(${lat}) ) * cos( radians( lng ) ) * cos( radians( lat ) - radians(${lng}) ) + sin( radians(${lat}) ) * sin( radians( lng ) ) ) ) AS distance FROM petpost HAVING (distance < ${dist}) AND count LIKE '%${searchAnimalType}%' AND (styles LIKE ${tagList}) ORDER BY id;`
*/

app.get(`/${path}&nearby`, (req, res) => {
  const filter = req.headers.filter ?
    JSON.parse(req.headers.filter) :
    { lat: 29.9459695, lng: -90.07005989999999 };
  if (!filter.distance) {
    filter.distance = 0.07;
  }
  const { lat, lng, distance } = filter;
  knex('waypoint')
    .select()
    .where(function inner() {
      this.where({ count: 0 })
        .whereBetween('lat', [lat - distance, lat + distance])
        .andWhereBetween('lng', [lng - distance, lng + distance]);
    })
    .orWhere(function inner() {
      this.whereNot({ count: 0 })
        .andWhereNot({ street: null })
        .whereBetween('lat', [lat - distance, lat + distance])
        .andWhereBetween('lng', [lng - distance, lng + distance]);
    })
    .join('route', 'route.id', '=', 'waypoint.id_route')
    .then((results) => {
      res.send(results);
    })
    .catch(err => res.status(400).send({ text: 'Something went wrong!', error: err }));
});

app.post(`/${path}`, async ({ body }, res) => {
  if (body.tripData.wayPoints) {
    const {
      tripData: {
        userId,
        routeTitle,
        wayPoints,
        distance: text,
        route_preview,
      },
      tripStats: {
        avgSpeed,
        rating,
        speedCounter,
        imageBase64,
        routeName,
      },
    } = body;
    const distance = Number(text.split(' ')[0]);
    let routeImage = '';
    const first = wayPoints[0].location;
    const last = wayPoints[wayPoints.length - 1].location;

    const { data: { results: [firstAddress] } } = await googleCalls.reverseGeocode(`${first.lat},${first.lng}`);

    const [firstStreet] = firstAddress.address_components.filter((component) => {
      if (component.types.indexOf('route') > -1) {
        return true;
      }
      return false;
    });

    const { data: { results: [lastAddress] } } = await googleCalls.reverseGeocode(`${last.lat},${last.lng}`);

    const [lastStreet] = lastAddress.address_components.filter((component) => {
      if (component.types.indexOf('route') > -1) {
        return true;
      }
      return false;
    });

    wayPoints[0].street = firstStreet.short_name;
    wayPoints[wayPoints.length - 1].street = lastStreet.short_name;

    if (imageBase64 !== '') {
      await cloudinary.uploader.upload(`data:image/jpeg;base64,${imageBase64}`, (result) => {
        if (result.error) {
          // eslint-disable-next-line
          console.error(JSON.stringify(result.error));
          routeImage = null;
        } else {
          routeImage = result.secure_url;
        }
      });
    }

    const newRoute = {
      display_name: routeName,
      route_name: routeTitle,
      id_user_account: userId,
      type: null,
      favorite_count: 0,
      current_rating: rating,
      photo_url: routeImage,
      route_preview,
      distance,
    };

    knex(path)
      .insert(newRoute)
      .returning('*')
      .then(([route]) => {
        const mappedWaypoints = wayPoints.map(({
          location: { lat, lng },
          street = null,
        }, count) => ({
          id_route: route.id,
          lat,
          lng,
          count,
          street,
        }));
        knex('waypoint')
          .insert(mappedWaypoints)
          // .returning('*')
          .then((result) => {
            res.send({
              type: 'Success!', result, routeId: route.id, route,
            });
          })
          .catch(err =>
            res
              .status(400)
              .send({ text: 'Something went wrong!', error: err }));
      })
      .catch(err =>
        res.status(400).send({ text: 'Something went wrong!', error: err }));
  } else {
    res.sendStatus(403);
  }
});

app.put(`/${path}`, (req, res) => {
  res.sendStatus(400);
});

app.delete(`/${path}`, (req, res) => {
  const { id_user_account } = req.body;
  if (Object.keys(req.body).length) {
    knex(path)
      .where(req.body)
      .update({ id_user_account: 0 })
      .then((updated) => {
        knex(path)
          .where({ id_user_account })
          .select()
          .then((routes) => {
            res.send(routes);
          });
      })
      .catch(err => res.status(400).send({ text: 'Something went wrong!', error: err }));
  } else {
    res.send('Please specify row');
  }
});

module.exports = app;
