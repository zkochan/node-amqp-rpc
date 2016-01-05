'use strict';

const Rpc = require('../../index');

let rpc = new Rpc({
  url: 'amqp://guest:guest@localhost:5672',
});

let allStats = {};

// rpc.callBroadcast() is rpc.call() + waiting multiple responses
// If remote handler without response data, you can use rpc.call() for initiate broadcast calls.
rpc.callBroadcast(
  'getWorkerStat',

  // request parameters
  { type: 'fullStat' },

  // call options
  {
    // wait response time  (1 seconds), after run onComplete
    ttl: 1000,

    // callback on each worker response
    onResponse(err, stat) {
      allStats[stat.hostname + ':' + stat.pid] = stat;
    },

    //callback on ttl expired
    onComplete() {
      console.log('----------------------- WORKER STATISTICS ----------------------------------------');
      for (let worker in allStats) {
        let s = allStats[worker];
        console.log(worker, '\tuptime=',
          s.uptime.toFixed(2) + ' seconds', '\tcounter=', s.counter);
      }
    },
  });
