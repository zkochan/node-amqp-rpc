'use strict'
const amqp = require('amqp')
const debug = require('debug')('qpc')

module.exports = function(options, cb) {
  return new Promise((resolve, reject) => {
    if (!options.amqpURL && !options.host) {
      options.amqpURL = 'amqp://guest:guest@localhost:5672'
    }

    let connection = amqp.createConnection(options)

    connection.on('ready', () => {
      debug('connected to ' + connection.serverProperties.product)

      /*
       * Added option autoDelete=false.
       * Otherwise we had an error in library node-amqp version > 0.1.7.
       * Text of such error: "PRECONDITION_FAILED - cannot redeclare
       *  exchange '<exchange name>' in vhost '/' with different type,
       *  durable, internal or autodelete value"
       */
      connection.exchange(options.exchangeName, {
        autoDelete: false,
      }, exchange => {
        debug('Exchange ' + exchange.name + ' is open')
        resolve({
          exchange,
          connection,
          createQ: (qname, cb) => {
            connection.queue(qname, queue => {
              queue.bind(exchange, qname, () => cb(queue))
            })
          },
        })
      })
    })
  })
}
