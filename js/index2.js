const express = require('express');
const axios = require('axios');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = 3000;

const API_KEY = 'SA2gwXmU8tMANuVvb1cei7oQc3FjEGOQ';
const CACHE_DIR = path.join(__dirname, 'cache');
if (!fs.existsSync(CACHE_DIR)) fs.mkdirSync(CACHE_DIR);

let stopsMap;
(async () => {
  const response = await fetch('https://leolesimple.com/infostation/arrets-stopPoint.json');
  stopsMap = await response.json();
})();

app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET');
  res.header('Access-Control-Allow-Headers', 'Content-Type');
  next();
});

app.get('/nextTrains', async (req, res) => {
  const stopId = req.query.stopId;
  if (!stopId) return res.status(400).json({ error: 'Paramètre stopId requis.' });

  const cachePath = path.join(CACHE_DIR, `IDFM:${stopId}.json`);

  try {
    if (fs.existsSync(cachePath)) {
      const age = (Date.now() - fs.statSync(cachePath).mtimeMs) / 1000;
      if (age < 60) {
        const rawPrimData = JSON.parse(fs.readFileSync(cachePath, 'utf-8'));
        const visits = rawPrimData?.Siri?.ServiceDelivery?.StopMonitoringDelivery?.[0]?.MonitoredStopVisit || [];
        const nextTrains = visits.map(visit => {
          const mvj = visit.MonitoredVehicleJourney;
          const mc = mvj.MonitoredCall;
          return {
            line: mvj.LineRef?.value,
            direction: mvj.DirectionRef?.value,
            destination: mvj.DestinationName?.[0]?.value,
            mission: mvj.JourneyNote?.map(n => n.value).join(', ') || '',
            trainNum: mvj.TrainNumbers?.[0]?.value || null,
            vehicleFeatures: mvj.VehicleFeatureRef?.[0] || null,
            journeyRed: mvj.FramedVehicleJourneyRef?.DatedVehicleJourneyRef || null,
            quai: mc?.ArrivalPlatformName?.value || null,
            times: {
              "st": {
                arrival: mc?.ExpectedArrivalTime || null,
                departure: mc?.ExpectedDepartureTime || null
              },
              "rt": {
                arrival: mc?.AimedArrivalTime || null,
                departure: mc?.AimedDepartureTime || null
              }
            },
            aQuai: mc.VehicleAtStop?.value || false,
            status: mc?.DepartureStatus || null,
          };
        });

        const payload = {
          stopId,
          arrname: stopsMap.find(s => s.zdaid === stopId)?.arrname || null,
          accessible: stopsMap.find(s => s.zdaid === stopId)?.arraccessibility || null,
          nextTrains,
        };
        return res.status(200).json(payload);
      }
    }

    const response = await axios.get(`https://prim.iledefrance-mobilites.fr/marketplace/stop-monitoring?MonitoringRef=STIF:StopArea:SP:${stopId}:`, {
      headers: {
        Accept: 'application/json',
        apikey: API_KEY,
      },
    });

    const visits = response.data?.Siri?.ServiceDelivery?.StopMonitoringDelivery?.[0]?.MonitoredStopVisit || [];

    const nextTrains = visits.map(visit => {
      const mvj = visit.MonitoredVehicleJourney;
      const mc = mvj.MonitoredCall;
      return {
        line: mvj.LineRef?.value,
        direction: mvj.DirectionRef?.value,
        destination: mvj.DestinationName?.[0]?.value,
        mission: mvj.JourneyNote?.map(n => n.value).join(', ') || '',
        trainNum: mvj.TrainNumbers?.[0]?.value || null,
        vehicleFeatures: mvj.VehicleFeatureRef?.[0] || null,
        journeyRed: mvj.FramedVehicleJourneyRef?.DatedVehicleJourneyRef || null,
        quai: mc?.ArrivalPlatformName?.value || null,
        times: {
          "st": {
            arrival: mc?.ExpectedArrivalTime || null,
            departure: mc?.ExpectedDepartureTime || null
          },
          "rt": {
            arrival: mc?.AimedArrivalTime || null,
            departure: mc?.AimedDepartureTime || null
          }
        },
        aQuai: mc.VehicleAtStop?.value || false,
        status: mc?.DepartureStatus || null,
      };
    });

    const payload = {
      stopId,
      arrname: stopsMap.find(s => s.zdaid === stopId)?.arrname || null,
      accessible: stopsMap.find(s => s.zdaid === stopId)?.arraccessibility || null,
      geopoint: stopsMap.find(s => s.zdaid === stopId)?.arrgeopoint || null,
      nextTrains,
    };

    fs.writeFileSync(cachePath, JSON.stringify(response.data));
    res.json(payload);
  } catch (err) {
    console.error(`[ERROR] ${err.message}`);
    res.status(500).json({ error: 'Erreur lors de la récupération des données.' });
  }
});

app.listen(PORT, () => {
  console.log(`Serveur proxy PRIM en écoute sur http://localhost:${PORT}`);
});