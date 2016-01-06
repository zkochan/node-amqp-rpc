'use strict'

const amqp = require('amqp')
const uuid = require('node-uuid').v4
const os = require('os')
const debug = require('debug')('qpc')
const memoize = require('memoizee')

function noop() {}

function Rpc(opt) {
  opt = opt || {}

  this._conn = opt.connection
  this._url = opt.url || 'amqp://guest:guest@localhost:5672'
  this._exchange = opt.exchangeInstance
  this._exchangeName = opt.exchange || 'rpc_exchange'
  this._exchangeOptions = opt.exchangeOptions || {
    exclusive: false,
    autoDelete: true,
  }
  this._implOptions = opt.ipmlOptions || {
    defaultExchangeName: this._exchangeName,
  }
  this._connOptions = opt.connOptions || {}

  this._resultsQueue = null
  this._resultsQueueName = null
  this._resultsCallback = {}

  this._cmds = {}

  this._connect = memoize(function(cb) {
    let options = this._connOptions
    if (!options.url && !options.host) {
      options.url = this._url
    }

    debug('createConnection options=', options,
      ', ipmlOptions=', this._implOptions || {})
    this._conn = amqp.createConnection(options, this._implOptions)

    this._conn.on('ready', () => {
      debug('connected to ' + this._conn.serverProperties.product)
      cb(this._conn)
    })
  }, { async: true })

  this._makeExchange = memoize(function(cb) {
    /*
     * Added option autoDelete=false.
     * Otherwise we had an error in library node-amqp version > 0.1.7.
     * Text of such error: "PRECONDITION_FAILED - cannot redeclare
     *  exchange '<exchange name>' in vhost '/' with different type,
     *  durable, internal or autodelete value"
     */
    this._exchange = this._conn.exchange(this._exchangeName, {
      autoDelete: false,
    }, exchange => {
      debug('Exchange ' + exchange.name + ' is open')
      cb(this._exchange)
    })
  }, { async: true })

  this._makeResultsQueue = memoize(function(cb) {
    this._resultsQueueName = this.generateQueueName('callback')

    this._makeExchange(() =>
      this._resultsQueue = this._conn.queue(
        this._resultsQueueName,
        this._exchangeOptions,
        queue => {
          debug('Callback queue ' + queue.name + ' is open')
          queue.subscribe(this._onResult.bind(this))

          queue.bind(this._exchange, this._resultsQueueName)
          debug('Bind queue ' + queue.name +
            ' to exchange ' + this._exchange.name)
          cb()
        }
      )
    )
  }, { async: true })
}

/**
 * generate unique name for new queue
 *
 * @returns {string}
 */

Rpc.prototype.generateQueueName = function(type) {
  return os.hostname() + ':pid' + process.pid + ':' + type + ':' +
    Math.random().toString(16).split('.')[1]
}

/**
 * disconnect from MQ broker
 */
Rpc.prototype.disconnect = function() {
  debug('disconnect()')
  if (!this._conn) return

  this._conn.end()
  this._conn = null
}

Rpc.prototype._onResult = function(message, headers, deliveryInfo) {
  debug('_onResult()')
  if (!this._resultsCallback[deliveryInfo.correlationId]) {
    return
  }

  let cb = this._resultsCallback[deliveryInfo.correlationId]

  let args = [].concat(message)

  cb.cb.apply(cb.context, args)

  if (cb.autoDeleteCallback !== false) {
    delete this._resultsCallback[deliveryInfo.correlationId]
  }
}

/**
 * call a remote command
 *
 * @param {string} cmd   command name
 * @param {Buffer|Object|String}params    parameters of command
 * @param {function} cb        callback
 * @param {object} context   context of callback
 * @param {object} options   advanced options of amqp
 */

Rpc.prototype.call = function(cmd, params, cb, context, options) {
  debug('call()', cmd)

  options = options || {}

  options.contentType = 'application/json'
  let corrId = options.correlationId || uuid()

  this._connect(() => {
    if (!cb) {
      this._createQ(cmd, () => this._exchange.publish(cmd, params, options))
      return
    }

    this._makeExchange(() =>
      this._makeResultsQueue(() => {
        this._resultsCallback[corrId] = {
          cb,
          context,
          autoDeleteCallback: !!options.autoDeleteCallback,
        }

        options.mandatory = true
        options.replyTo = this._resultsQueueName
        options.correlationId = corrId
        //options.domain    = "localhost"

        this._exchange.publish(cmd, params, options, err => {
          if (err) {
            delete this._resultsCallback[corrId]

            cb(err)
          }
        })
      })
    )
  })

  return corrId
}

Rpc.prototype._createQ = memoize(function(qname, cb) {
  this._connect(() => this._conn.queue(qname, queue => {
    this._makeExchange(() => {
      queue.bind(this._exchange, qname, () => cb(queue))
    })
  }))
}, { async: true })

/**
 * add new command handler
 * @param {string} cmd                command name or match string
 * @param {function} cb               handler
 * @param {object} context            context for handler
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
Rpc.prototype.on = function(cmd, cb, context, options) {
  debug('on(), routingKey=%s', cmd)
  if (this._cmds[cmd]) {
    return false
  }

  this._createQ(cmd, queue => {
    this._cmds[cmd] = { queue }
    queue.subscribe((message, d, headers, deliveryInfo) => {
      let cmdInfo = {
        cmd: deliveryInfo.routingKey,
        exchange: deliveryInfo.exchange,
        contentType: deliveryInfo.contentType,
        size: deliveryInfo.size,
      }

      if (deliveryInfo.correlationId && deliveryInfo.replyTo) {
        return cb.call(context, message, function(err, data) {
          let options = {
            correlationId: deliveryInfo.correlationId,
          }

          this._exchange.publish(
            deliveryInfo.replyTo,
            Array.prototype.slice.call(arguments),
            options
          )
        }.bind(this), cmdInfo)
      }

      return cb.call(context, message, noop, cmdInfo)
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
Rpc.prototype.off = function(cmd) {
  debug('off', cmd)
  if (!this._cmds[cmd]) {
    return false
  }

  let c = this._cmds[cmd]

  function unsubscribe(cb) {
    if (c.ctag) {
      c.queue.unsubscribe(c.ctag)
    }

    if (cb) {
      return cb()
    }
  }

  let unbind = cb => {
    if (c.queue) {
      unsubscribe(() => {
        c.queue.unbind(this._exchange, cmd)

        if (cb) {
          return cb()
        }
      })
    }
  }

  function destroy(cb) {
    if (c.queue) {
      unbind(() => {
        c.queue.destroy()

        if (cb) {
          return cb()
        }
      })
    }
  }

  destroy(() => delete this._cmds[cmd])

  return true
}

module.exports = Rpc
