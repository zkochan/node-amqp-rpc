'use strict'
const uuid = require('node-uuid').v4
const os = require('os')
const cbStore = require('callback-store')
const createConnection = require('./create-connection')

module.exports = opt => {
  return createConnection(opt)
  .then(amqp => new Promise((resolve, reject) => {
    opt = opt || {}

    const connection = amqp.connection
    const exchange = amqp.exchange
    const exchangeOptions = opt.exchangeOptions || {
      exclusive: false,
      autoDelete: true,
    }

    const resultsQueueName = generateQueueName('callback')
    const callbacks = cbStore()
    const ttl = opt.ttl || 5e3 // 5 seconds

    function generateQueueName (type) {
      return os.hostname() + ':pid' + process.pid + ':' + type + ':' +
        Math.random().toString(16).split('.')[1]
    }

    function onResult (message, headers, deliveryInfo) {
      const cb = callbacks.get(deliveryInfo.correlationId)
      if (!cb) return

      const args = [].concat(message)

      cb.apply(null, args)
    }

    /**
     * call a remote command
     *
     * @param {string} cmd   command name
     * @param {Buffer|Object|String}params    parameters of command
     * @param {function} cb        callback
     * @param {object} options   advanced options of amqp
     */
    function call (cmd, params, cb, options) {
      options = options || {}
      options.contentType = 'application/json'

      amqp.createQ(cmd, () => {
        if (!cb) {
          exchange.publish(cmd, params, options)
          return
        }

        const corrId = uuid()
        callbacks.add(corrId, cb, ttl)

        options.mandatory = true
        options.replyTo = resultsQueueName
        options.correlationId = corrId
        //options.domain    = "localhost"

        exchange.publish(cmd, params, options, err => {
          if (err) {
            const cb = callbacks.get(corrId)
            cb(err)
          }
        })
      })
    }

    connection.queue(
      resultsQueueName,
      exchangeOptions,
      queue => {
        queue.subscribe(onResult)
        queue.bind(exchange, resultsQueueName)
        resolve({call})
      }
    )
  }))
}
