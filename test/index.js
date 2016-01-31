'use strict'

const expect = require('chai').expect
const qpc = require('..')

describe('qpc', function() {
  let rpc

  beforeEach(function() {
    rpc = qpc({
      url: 'amqp://guest:guest@localhost:5672',
    })
  })

  it('should send/recieve message', function(done) {
    rpc.on('foo', function(args) {
      expect(args[0]).to.eq(1)
      expect(args[1]).to.eq(2)
      done()
    })

    rpc.call('foo', [1, 2])
  })

  it('should send response', function(done) {
    rpc.on('sum', function(args, cb) {
      cb(args[0] + args[1])
    })

    rpc.call('sum', [1, 2], function(res) {
      expect(res).to.eq(3)
      done()
    })
  })

  it('should respond with an error in case of timout', function(done) {
    let rpc = qpc({
      url: 'amqp://guest:guest@localhost:5672',
      ttl: 100,
    })

    rpc.call('timeout', [1, 2], function(res) {
      expect(res).to.be.instanceOf(Error)
      done()
    })
  })

  it('should recieve message when subscribe after publish', function(done) {
    rpc.call('foo2', [1, 2])

    setTimeout(function() {
      rpc.on('foo2', function(args) {
        expect(args[0]).to.eq(1)
        expect(args[1]).to.eq(2)
        done()
      })
    }, 1500)
  })
})
