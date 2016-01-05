'use strict';

const os = require('os');
const workerName = os.hostname() + ':' + process.pid;
const Rpc = require('../../index');

let counter = 0;

let rpc = new Rpc({
  url: 'amqp://guest:guest@localhost:5672',
});

rpc.onBroadcast('getWorkerStat', function(params, cb)    {
  if (params && params.type === 'fullStat') {
    cb(null, {
      pid: process.pid,
      hostname: os.hostname(),
      uptime: process.uptime(),
      counter: counter++,
    });
    return;
  }
  cb(null, { counter: counter++ });
});

rpc.call('log', { worker: workerName, message: 'worker started' });
