'use strict'
const expect = require('chai').expect
const consumer = require('../lib/consumer')
const publisher = require('../lib/publisher')

describe('qpc', function() {
  let con
  let pub

  beforeEach(function(done) {
    consumer({
      amqpURL: 'amqp://guest:guest@localhost:5672',
      exchangeName: 'foo',
    })
    .then(con$ => {
      con = con$
      return publisher({
        amqpURL: 'amqp://guest:guest@localhost:5672',
        exchangeName: 'foo',
      })
    })
    .then(pub$ => {
      pub = pub$
      done()
    })
    .catch(done)
  })

  it('should send/recieve message', function(done) {
    con.on('foo', args => {
      expect(args[0]).to.eq(1)
      expect(args[1]).to.eq(2)
      done()
    })

    pub.call('foo', [1, 2])
  })

  it('should send response', function(done) {
    con.on('sum', (args, cb) => cb(args[0] + args[1]))

    pub.call('sum', [1, 2], res => {
      expect(res).to.eq(3)
      done()
    })
  })

  it('should respond with an error in case of timout', function(done) {
    return publisher({
      url: 'amqp://guest:guest@localhost:5672',
      exchangeName: 'foo',
      ttl: 100,
    })
    .then(pub => {
      pub.call('timeout', [1, 2], res => {
        expect(res).to.be.instanceOf(Error)
        done()
      })
    })
  })

  it('should recieve message when subscribe after publish', function(done) {
    pub.call('foo2', [1, 2])

    setTimeout(function() {
      con.on('foo2', args => {
        expect(args[0]).to.eq(1)
        expect(args[1]).to.eq(2)
        done()
      })
    }, 1500)
  })
})
