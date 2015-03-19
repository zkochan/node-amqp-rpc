'use strict';

var amqp = require('amqp');
var uuid = require('node-uuid').v4;
var os = require('os');
var debug = require('debug')('amqp-rpc');
var queueNo = 0;

var noop = function () {};

function Rpc(opt) {
  opt = opt || {};

  this._conn = opt.connection ? opt.connection : null;
  this._url = opt.url ? opt.url : 'amqp://guest:guest@localhost:5672';
  this._exchange = opt.exchangeInstance ? opt.exchangeInstance : null;
  this._exchangeName = opt.exchange ? opt.exchange : 'rpc_exchange';
  this._exchangeOptions = opt.exchangeOptions ? opt.exchangeOptions : {
    exclusive: false,
    autoDelete: true
  };
  this._implOptions = opt.ipmlOptions || {
    defaultExchangeName: this._exchangeName
  };
  this._connOptions = opt.connOptions || {};

  this._resultsQueue = null;
  this._resultsQueueName = null;
  this._resultsCallback = {};
  this._makeResultsCallback = [];

  this._cmds = {};

  this._connCbs = [];
  this._exchangeCbs = [];
}

/**
 * generate unique name for new queue
 * @returns {string}
 */

Rpc.prototype.generateQueueName = function (type) {
  return /*'njsListener:' +*/ os.hostname() + ':pid' + process.pid + ':' + type + ':' +
    Math.random().toString(16).split('.')[1];
};


Rpc.prototype._connect = function (cb) {
  cb = cb || noop;

  if (this._conn) {
    if (this._connCbs.length > 0) {
      this._connCbs.push(cb);
      return true;
    }

    return cb(this._conn);
  }

  var $this = this;

  this._connCbs.push(cb);
  var options = this._connOptions;
  if (!options.url && !options.host) {
    options.url = this._url;
  }
  debug('createConnection options=', options,
    ', ipmlOptions=', this._implOptions || {});
  this._conn = amqp.createConnection(
    options,
    this._implOptions
  );

  this._conn.on('ready', function () {
    debug('connected to ' + $this._conn.serverProperties.product);
    var cbs = $this._connCbs;
    $this._connCbs = [];

    for (var i = 0; i < cbs.length; i++) {
      cbs[i]($this._conn);
    }
  });
};
/**
 * disconnect from MQ broker
 */

Rpc.prototype.disconnect = function () {
  debug('disconnect()');
  if (!this._conn) {
    return;
  }
  this._conn.end();
  this._conn = null;
};

Rpc.prototype._makeExchange = function (cb) {
  cb = cb || noop;

  if (this._exchange) {
    if (this._exchangeCbs.length > 0) {
      this._exchangeCbs.push(cb);

      return true;
    }

    return cb(this._exchange);
  }

  var $this = this;

  this._exchangeCbs.push(cb);
  /*
   * Added option autoDelete=false.
   * Otherwise we had an error in library node-amqp version > 0.1.7.
   * Text of such error: "PRECONDITION_FAILED - cannot redeclare
   *  exchange '<exchange name>' in vhost '/' with different type,
   *  durable, internal or autodelete value"
   */
  this._exchange = this._conn.exchange(this._exchangeName, {
    autoDelete: false
  }, function (exchange) {
    debug('Exchange ' + exchange.name + ' is open');
    var cbs = $this._exchangeCbs;
    $this._exchangeCbs = [];

    for (var i = 0; i < cbs.length; i++) {
      cbs[i]($this._exchange);
    }
  });

};

Rpc.prototype._makeResultsQueue = function (cb) {
  cb = cb || noop;

  if (this._resultsQueue) {
    if (this._makeResultsCallback.length > 0) {

      this._makeResultsCallback.push(cb);
      return true;
    }
    return cb(this._resultsQueue);
  }

  var $this = this;

  this._resultsQueueName = this.generateQueueName('callback');
  this._makeResultsCallback.push(cb);

  $this._makeExchange(function () {

    $this._resultsQueue = $this._conn.queue(
      $this._resultsQueueName,
      $this._exchangeOptions,
      function (queue) {
        debug('Callback queue ' + queue.name + ' is open');
        queue.subscribe(function () {
          $this._onResult.apply($this, arguments);
        });

        queue.bind($this._exchange, $this._resultsQueueName);
        debug('Bind queue ' + queue.name +
          ' to exchange ' + $this._exchange.name);
        var cbs = $this._makeResultsCallback;
        $this._makeResultsCallback = [];

        for (var i = 0; i < cbs.length; i++) {
          cbs[i](queue);
        }
      }
    );
  });
};

Rpc.prototype._onResult = function (message, headers, deliveryInfo) {
  debug('_onResult()');
  if (!this._resultsCallback[deliveryInfo.correlationId]) {
    return;
  }

  var cb = this._resultsCallback[deliveryInfo.correlationId];

  var args = [];
  if (Array.isArray(message)) {

    for (var i = 0; i < message.length; i++) {
      args.push(message[i]);
    }
  } else {
    args.push(message);
  }

  cb.cb.apply(cb.context, args);

  if (cb.autoDeleteCallback !== false) {
    delete this._resultsCallback[deliveryInfo.correlationId];
  }
};

/**
 * call a remote command
 * @param {string} cmd   command name
 * @param {Buffer|Object|String}params    parameters of command
 * @param {function} cb        callback
 * @param {object} context   context of callback
 * @param {object} options   advanced options of amqp
 */

Rpc.prototype.call = function (cmd, params, cb, context, options) {
  debug('call()', cmd);
  var $this = this;

  options = options || {};

  options.contentType = 'application/json';
  var corrId = options.correlationId || uuid();

  this._connect(function () {

    if (cb) {

      $this._makeExchange(function () {

        $this._makeResultsQueue(function () {

          $this._resultsCallback[corrId] = {
            cb: cb,
            context: context,
            autoDeleteCallback: !!options.autoDeleteCallback
          };


          options.mandatory = true;
          options.replyTo = $this._resultsQueueName;
          options.correlationId = corrId;
          //options.domain    = "localhost";

          $this._exchange.publish(
            cmd,
            params,
            options,
            function (err) {
              if (err) {
                delete $this._resultsCallback[corrId];

                cb(err);
              }
            }
          );
        });
      });

    } else {

      $this._makeExchange(function () {

        $this._exchange.publish(
          cmd,
          params,
          options
        );
      });
    }
  });

  return corrId;
};

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


Rpc.prototype.on = function (cmd, cb, context, options) {
  debug('on(), routingKey=%s', cmd);
  if (this._cmds[cmd]) {
    return false;
  }
  options = options || {};

  var $this = this;

  this._connect(function () {

    $this._conn.queue(options.queueName || cmd, function (queue) {
      $this._cmds[cmd] = {
        queue: queue
      };
      queue.subscribe(function (message, d, headers, deliveryInfo) {

        var cmdInfo = {
          cmd: deliveryInfo.routingKey,
          exchange: deliveryInfo.exchange,
          contentType: deliveryInfo.contentType,
          size: deliveryInfo.size
        };

        if (deliveryInfo.correlationId && deliveryInfo.replyTo) {

          return cb.call(context, message, function (err, data) {

            var options = {
              correlationId: deliveryInfo.correlationId
            };

            $this._exchange.publish(
              deliveryInfo.replyTo,
              Array.prototype.slice.call(arguments),
              options
            );
          }, cmdInfo);
        } else {
          return cb.call(context, message, noop, cmdInfo);
        }
      });

      $this._makeExchange(function () {
        queue.bind($this._exchange, cmd);
      });

    });
  });

  return true;
};

/**
 * remove command handler added with "on" method
 * @param {string} cmd       command or match string
 * @return {boolean}
 */

Rpc.prototype.off = function (cmd) {
  debug('off', cmd);
  if (!this._cmds[cmd]) {
    return false;
  }

  var $this = this;
  var c = $this._cmds[cmd];

  function unsubscribe(cb) {
    if (c.ctag) {
      c.queue.unsubscribe(c.ctag);
    }

    if (cb) {
      return cb();
    }
  }

  function unbind(cb) {

    if (c.queue) {
      unsubscribe(function () {
        c.queue.unbind($this._exchange, cmd);

        if (cb) {
          return cb();
        }
      });

    }
  }

  function destroy(cb) {

    if (c.queue) {
      unbind(function () {
        c.queue.destroy();

        if (cb) {
          return cb();
        }
      });
    }
  }

  destroy(function () {
    delete $this._cmds[cmd];
  });

  return true;
};

/**
 * call broadcast
 * @param {string} cmd
 * @param params
 * @param options
 */


Rpc.prototype.callBroadcast = function (cmd, params, options) {

  var $this = this;

  options = options || {};
  options.broadcast = true;
  options.autoDeleteCallback = options.ttl ? false : true;
  var corrId = this.call.call(this, cmd, params, options.onResponse, options.context, options);
  if (options.ttl) {
    setTimeout(function () {
      //release cb
      if ($this._resultsCallback[corrId]) {
        delete $this._resultsCallback[corrId];
      }
      options.onComplete.call(options.context, cmd, options);
    }, options.ttl);
  }
};

/**
 * subscribe to broadcast commands
 * @param {string} cmd
 * @param {function} cb
 * @param {object} context
 */

Rpc.prototype.onBroadcast = function (cmd, cb, context, options) {

  options = options || {};
  options.queueName = this.generateQueueName('broadcast:q' + (queueNo++));
  return this.on.call(this, cmd, cb, context, options);
};


/**
 *
 * @type {Function}
 */

Rpc.prototype.offBroadcast = Rpc.prototype.off;


module.exports.amqpRPC = Rpc;

module.exports.factory = function (opt) {
  return new Rpc(opt);
};