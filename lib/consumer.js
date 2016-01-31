'use strict'
const amqp = require('amqp')
const debug = require('debug')('qpc')
const memoize = require('memoizee')
const createConnection = require('./create-connection')

function noop() {}

module.exports = function(opt) {
  return createConnection(opt)
  .then(amqp => new Promise((resolve, reject) => {
    opt = opt || {}

    let connection = amqp.connection
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

    function off(cmd) {
      debug('off', cmd)
      if (!cmds[cmd]) return false

      let c = cmds[cmd]

      function unsubscribe(cb) {
        if (c.ctag) c.queue.unsubscribe(c.ctag)

        if (cb) return cb()
      }

      let unbind = cb => {
        if (c.queue) {
          unsubscribe(() => {
            c.queue.unbind(exchange, cmd)

            if (cb) return cb()
          })
        }
      }

      function destroy(cb) {
        if (c.queue) {
          unbind(() => {
            c.queue.destroy()

            if (cb) return cb()
          })
        }
      }

      destroy(() => delete cmds[cmd])

      return true
    }

    resolve({ off, on })
  }))
}
