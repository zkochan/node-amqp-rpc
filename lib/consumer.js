'use strict'
const debug = require('debug')('qpc')
const createConnection = require('./create-connection')

function noop() {}

module.exports = function(opt) {
  return createConnection(opt)
  .then(amqp => new Promise((resolve, reject) => {
    opt = opt || {}

    let exchange = amqp.exchange

    let cmds = {}

    function on(cmd, cb) {
      debug('on(), routingKey=%s', cmd)
      if (cmds[cmd]) return false

      amqp.createQ(cmd, queue => {
        cmds[cmd] = { queue }
        queue.subscribe((message, d, headers, deliveryInfo) => {
          let cmdInfo = {
            cmd: deliveryInfo.routingKey,
            exchange: deliveryInfo.exchange,
            contentType: deliveryInfo.contentType,
            size: deliveryInfo.size,
          }

          if (deliveryInfo.correlationId && deliveryInfo.replyTo) {
            return cb(message, function() {
              let options = {
                correlationId: deliveryInfo.correlationId,
              }

              exchange.publish(
                deliveryInfo.replyTo,
                Array.prototype.slice.call(arguments),
                options
              )
            }, cmdInfo)
          }

          return cb(message, noop, cmdInfo)
        })
      })

      return true
    }

    resolve({ on })
  }))
}
