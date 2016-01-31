'use strict'
const amqp = require('amqp')
const uuid = require('node-uuid').v4
const os = require('os')
const debug = require('debug')('qpc')
const memoize = require('memoizee')
const CallbackStore = require('callback-store')

function noop() {}

module.exports = function(opt) {
  opt = opt || {}

  let conn = opt.connection
  let url = opt.url || 'amqp://guest:guest@localhost:5672'
  let exchange = opt.exchangeInstance
  let exchangeName = opt.exchange || 'rpc_exchange'
  let exchangeOptions = opt.exchangeOptions || {
    exclusive: false,
    autoDelete: true,
  }
  let implOptions = opt.ipmlOptions || {
    defaultExchangeName: exchangeName,
  }
  let connOptions = opt.connOptions || {}

  let resultsQueue = null
  let resultsQueueName = null
  let callbacks = new CallbackStore()
  let ttl = opt.ttl || 5e3 // 5 seconds

  let cmds = {}

  let connect = memoize(function(cb) {
    let options = connOptions
    if (!options.url && !options.host) {
      options.url = url
    }

    debug('createConnection options=', options,
      ', ipmlOptions=', implOptions || {})
    conn = amqp.createConnection(options, implOptions)

    conn.on('ready', () => {
      debug('connected to ' + conn.serverProperties.product)
      cb(conn)
    })
  }, { async: true })

  let makeExchange = memoize(function(cb) {
    /*
     * Added option autoDelete=false.
     * Otherwise we had an error in library node-amqp version > 0.1.7.
     * Text of such error: "PRECONDITION_FAILED - cannot redeclare
     *  exchange '<exchange name>' in vhost '/' with different type,
     *  durable, internal or autodelete value"
     */
    exchange = conn.exchange(exchangeName, {
      autoDelete: false,
    }, exchange => {
      debug('Exchange ' + exchange.name + ' is open')
      cb(exchange)
    })
  }, { async: true })

  let makeResultsQueue = memoize(function(cb) {
    resultsQueueName = generateQueueName('callback')

    makeExchange(() =>
      resultsQueue = conn.queue(
        resultsQueueName,
        exchangeOptions,
        queue => {
          debug('Callback queue ' + queue.name + ' is open')
          queue.subscribe(onResult)

          queue.bind(exchange, resultsQueueName)
          debug('Bind queue ' + queue.name +
            ' to exchange ' + exchange.name)
          cb()
        }
      )
    )
  }, { async: true })

  /**
   * generate unique name for new queue
   *
   * @returns {string}
   */
  function generateQueueName(type) {
    return os.hostname() + ':pid' + process.pid + ':' + type + ':' +
      Math.random().toString(16).split('.')[1]
  }

  /**
   * disconnect from MQ broker
   */
  function disconnect() {
    debug('disconnect()')
    if (!conn) return

    conn.end()
    conn = null
  }

  function onResult(message, headers, deliveryInfo) {
    debug('_onResult()')
    let cb = callbacks.get(deliveryInfo.correlationId)
    if (!cb) return

    let args = [].concat(message)

    cb.apply(null, args)
  }

  let createQ = memoize(function(qname, cb) {
    connect(() => conn.queue(qname, queue => {
      makeExchange(() => {
        queue.bind(exchange, qname, () => cb(queue))
      })
    }))
  }, { async: true })

  /**
   * call a remote command
   *
   * @param {string} cmd   command name
   * @param {Buffer|Object|String}params    parameters of command
   * @param {function} cb        callback
   * @param {object} options   advanced options of amqp
   */
  function call(cmd, params, cb, options) {
    debug('call()', cmd)

    options = options || {}
    options.contentType = 'application/json'

    connect(() => {
      if (!cb) {
        createQ(cmd, () => exchange.publish(cmd, params, options))
        return
      }

      makeExchange(() =>
        makeResultsQueue(() => {
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
      )
    })
  }

  /**
   * add new command handler
   * @param {string} cmd                command name or match string
   * @param {function} cb               handler
   * @param {object} options            advanced options
   * @param {string} options.queueName  name of queue. Default equal to "cmd" parameter
   * @param {boolean} options.durable   If true, the queue will be marked as durable.
   *                                    Durable queues remain active when a server restarts.
   *                                    Non-durable queues (transient queues) are purged if/when a server restarts.
   *                                    Note that durable queues do not necessarily hold persistent messages,
   *                                    although it does not make sense to send persistent messages to a transient queue.

   * @param {boolean} options.exclusive Exclusive queues may only be accessed by the current connection,
   *                                    and are deleted when that connection closes.
   * @param {boolean} options.autoDelete If true, the queue is deleted when all consumers have finished using it.
   *                                     The last consumer can be cancelled either explicitly or because its channel is closed.
   *                                     If there was no consumer ever on the queue, it won't be deleted. Applications
   *                                     can explicitly delete auto-delete queues using the Delete method as normal.
   * @return {boolean}
   */
  function on(cmd, cb, options) {
    debug('on(), routingKey=%s', cmd)
    if (cmds[cmd]) return false

    createQ(cmd, queue => {
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

  /**
   * remove command handler added with "on" method
   *
   * @param {string} cmd       command or match string
   * @return {boolean}
   */
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

  return {
    generateQueueName,
    off,
    on,
    call,
    disconnect,
  }
}
