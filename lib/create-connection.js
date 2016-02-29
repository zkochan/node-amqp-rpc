'use strict'
const amqp = require('amqp')
const debug = require('debug')('qpc')

module.exports = (options, cb) => {
  return new Promise((resolve, reject) => {
    if (!options.uri && !options.host) {
      options.uri = 'amqp://guest:guest@localhost:5672'
    }

    const connection = amqp.createConnection(options)

    connection.on('ready', () => {
      debug('connected to ' + connection.serverProperties.product)

      connection.exchange(options.exchangeName, {
        autoDelete: false,
      }, exchange => {
        debug('Exchange ' + exchange.name + ' is open')
        resolve({
          exchange,
          connection,
          createQ (qname, cb) {
            connection.queue(qname, queue => {
              queue.bind(exchange, qname, () => cb(queue))
            })
          },
        })
      })
    })
  })
}
