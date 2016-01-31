'use strict'

const qpc = require('../..')

let rpc = qpc({
  url: 'amqp://guest:guest@localhost:5672',
})

rpc.on('inc', function(param, cb) {
  let prevVal = param
  let nextVal = param + 2
  cb(++param, prevVal, nextVal)
})

rpc.on('say.*', function(param, cb, inf) {
  let arr = inf.cmd.split('.')

  let name = (param && param.name) ? param.name : 'world'

  cb(arr[1] + ' ' + name + '!')
})

rpc.on('withoutCB', function(param, cb, inf) {
  if (cb) {
    cb('please run function without cb parameter')
    return
  }
  console.log('this is function withoutCB')
})
