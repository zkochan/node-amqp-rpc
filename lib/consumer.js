'use strict'
const createConnection = require('./create-connection')

module.exports = opt => {
  return createConnection(opt)
  .then(amqp => new Promise((resolve, reject) => {
    opt = opt || {}

    const exchange = amqp.exchange

    const cmds = {}

    function on (cmd, cb) {
      if (cmds[cmd]) return false

      amqp.createQ(cmd, queue => {
        cmds[cmd] = { queue }
        queue.subscribe((message, d, headers, deliveryInfo) => {
          const cmdInfo = {
            cmd: deliveryInfo.routingKey,
            exchange: deliveryInfo.exchange,
            contentType: deliveryInfo.contentType,
            size: deliveryInfo.size,
          }

          if (deliveryInfo.correlationId && deliveryInfo.replyTo) {
            return cb(message, function () {
              const options = {
                correlationId: deliveryInfo.correlationId,
              }

              exchange.publish(
                deliveryInfo.replyTo,
                Array.prototype.slice.call(arguments),
                options
              )
            }, cmdInfo)
          }

          return cb(message, () => {}, cmdInfo)
        })
      })

      return true
    }

    resolve({ on })
  }))
}
