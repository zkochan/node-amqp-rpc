'use strict'
const uuid = require('node-uuid').v4
const os = require('os')
const debug = require('debug')('qpc')
const cbStore = require('callback-store')
const createConnection = require('./create-connection')

module.exports = function (opt) {
  return createConnection(opt)
  .then(amqp => new Promise((resolve, reject) => {
    opt = opt || {}

    let connection = amqp.connection
    let exchange = amqp.exchange
    let exchangeOptions = opt.exchangeOptions || {
      exclusive: false,
      autoDelete: true,
    }

    let resultsQueueName = generateQueueName('callback')
    let callbacks = cbStore()
    let ttl = opt.ttl || 5e3 // 5 seconds

    function generateQueueName (type) {
      return os.hostname() + ':pid' + process.pid + ':' + type + ':' +
        Math.random().toString(16).split('.')[1]
    }

    function onResult (message, headers, deliveryInfo) {
      debug('_onResult()')
      let cb = callbacks.get(deliveryInfo.correlationId)
      if (!cb) return

      let args = [].concat(message)

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
      debug('call()', cmd)

      options = options || {}
      options.contentType = 'application/json'

      amqp.createQ(cmd, () => {
        if (!cb) {
          exchange.publish(cmd, params, options)
          return
        }

        let corrId = uuid()
        callbacks.add(corrId, cb, ttl)

        options.mandatory = true
        options.replyTo = resultsQueueName
        options.correlationId = corrId
        //options.domain    = "localhost"

        exchange.publish(cmd, params, options, err => {
          if (err) {
            let cb = callbacks.get(corrId)
            cb(err)
          }
        })
      })
    }

    connection.queue(
      resultsQueueName,
      exchangeOptions,
      queue => {
        debug('Callback queue ' + queue.name + ' is open')
        queue.subscribe(onResult)

        queue.bind(exchange, resultsQueueName)
        debug('Bind queue ' + queue.name +
          ' to exchange ' + exchange.name)
        resolve({call})
      }
    )
  }))
}
