'use strict';

const DEPARTURE_STATUS = {
  SCHEDULED: 'scheduled',   // GTFS statique, pas encore passé
  EXPECTED:  'expected',    // PRIM RT, prévu à l'heure
  DELAYED:   'delayed',     // PRIM RT, retard > 5 min
  CANCELLED: 'cancelled',   // PRIM RT, annulé
  PASSED:    'passed',      // GTFS statique, dépassé
  ARRIVED:   'arrived',     // PRIM RT, à quai
  DEPARTED:  'departed',    // PRIM RT, fermé / parti
};

const ROUTE_TYPE = {
  TRAM:  0,
  METRO: 1,
  TRAIN: 2,
  BUS:   3,
};

module.exports = { DEPARTURE_STATUS, ROUTE_TYPE };
