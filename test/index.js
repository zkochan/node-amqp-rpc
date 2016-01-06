'use strict';

const expect = require('chai').expect;
const Qpc = require('../');

describe('qpc', function() {
  it('should send/recieve message', function(done) {
    let rpc = new Qpc({
      url: 'amqp://guest:guest@localhost:5672',
    });

    rpc.on('foo', function(args) {
      expect(args[0]).to.eq(1);
      expect(args[1]).to.eq(2);
      done();
    });

    rpc.call('foo', [1, 2]);
  });

  it('should send response', function(done) {
    let rpc = new Qpc({
      url: 'amqp://guest:guest@localhost:5672',
    });

    rpc.on('sum', function(args, cb) {
      cb(args[0] + args[1]);
    });

    rpc.call('sum', [1, 2], function(res) {
      expect(res).to.eq(3);
      done();
    });
  });
});
