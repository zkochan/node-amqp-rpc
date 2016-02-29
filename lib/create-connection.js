'use strict'
const amqp = require('amqp')

module.exports = (options, cb) => {
  return new Promise((resolve, reject) => {
    if (!options.uri && !options.host) {
      options.uri = 'amqp://guest:guest@localhost:5672'
    }

    const connection = amqp.createConnection(options)

    connection.on('ready', () => {
      connection.exchange(options.exchangeName, {
        autoDelete: false,
      }, exchange => {
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
