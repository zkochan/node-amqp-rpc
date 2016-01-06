# qpc

RPC library based on AMQP protocol.

[![Dependency Status](https://david-dm.org/rpcjs/qpc/status.svg?style=flat)](https://david-dm.org/rpcjs/qpc)
[![Build Status](https://travis-ci.org/rpcjs/qpc.svg?branch=master)](https://travis-ci.org/rpcjs/qpc)
[![npm version](https://badge.fury.io/js/qpc.svg)](http://badge.fury.io/js/qpc)


## Install RabbitMQ

```
apt-get install rabbitmq-server
```


## Install library

```
npm install qpc
```


## round-robin

Example: Call remote function.
Run multiple servers.js for round-robin shared.


### server.js example

```js
const Qpc = require('qpc');

let rpc = new Qpc({
  url: 'amqp://guest:guest@localhost:5672',
});

rpc.on('inc', function(param, cb) {
  let prevVal = param;
  let nextVal = param + 2;
  cb(++param, prevVal, nextVal);
});

rpc.on('say.*', function(param, cb, inf) {
  let arr = inf.cmd.split('.');

  let name = (param && param.name) ? param.name : 'world';

  cb(arr[1] + ' ' + name + '!');
});

rpc.on('withoutCB', function(param, cb, inf) {
  if (cb) {
    cb('please run function without cb parameter')
    return;
  }

  console.log('this is function withoutCB');
});
```


### client.js example

```js
const Qpc = require('qpc');

let rpc = new Qpc({
  url: 'amqp://guest:guest@localhost:5672',
});

rpc.call('inc', 5, function() {
  console.log('results of inc:', arguments);  //output: [6,4,7]
});

rpc.call('say.Hello', { name: 'John' }, function(msg) {
  console.log('results of say.Hello:', msg);  //output: Hello John!
});

rpc.call('withoutCB', {}, function(msg) {
  console.log('withoutCB results:', msg);  //output: please run function without cb parameter
});

rpc.call('withoutCB', {}); //output message on server side console
```


## broadcast

Example: Core receiving data from all workers.
Run multiple worker.js for broadcast witness.
The core.js must be launched after all worker.js instances.

### example/broadcast/worker.js

```js
const Qpc = require('qpc');
const os = require('os');
let workerName = os.hostname() + ':' + process.pid;
let counter = 0;

let rpc = new Qpc({
  url: 'amqp://guest:guest@localhost:5672',
});

rpc.onBroadcast('getWorkerStat', function(params, cb)    {
  if(params && params.type === 'fullStat') {
    cb(null, {
      pid: process.pid,
      hostname: os.hostname(),
      uptime: process.uptime(),
      counter: counter++
    });
    return;
  }

  cb(null, { counter: counter++ });
});
```

### example/broadcast/core.js

```js
const Qpc = require('qpc');

let rpc = new Qpc({
  url: 'amqp://guest:guest@localhost:5672',
});

let all_stats = {};

// rpc.callBroadcast() is rpc.call() + waiting multiple responses
// If remote handler without response data, you can use rpc.call() for initiate broadcast calls.

rpc.callBroadcast(
  'getWorkerStat',
  { type: 'fullStat'},                    //request parameters
  {                                       //call options
    ttl: 1000,                          //wait response time  (1 seconds), after run onComplete
    onResponse(err, stat)  {  //callback on each worker response
      all_stats[stat.hostname + ':' + stat.pid] = stat;
    },
    onComplete()  {   //callback on ttl expired
      console.log('----------------------- WORKER STATISTICS ----------------------------------------');
      for (let worker in all_stats) {
        let s = all_stats[worker];
        console.log(worker, '\tuptime=', s.uptime.toFixed(2) + ' seconds', '\tcounter=', s.counter);
      }
    }
  });
```

Results for three workers:
```
    ----------------------- WORKER STATISTICS ----------------------------------------
    host1:2612 	uptime= 2470.39 seconds 	counter= 2
    host2:1615 	uptime= 3723.53 seconds 	counter= 8
    host2:2822 	uptime= 2279.16 seconds 	counter= 3
```


## License

MIT
