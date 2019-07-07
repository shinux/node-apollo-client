
const Apollo = require('../dist/index');
const assert = require('assert');
const nock = require('nock');
const Bluebird = require('bluebird');

function sleep(ms) {
  return new Bluebird(resolve => {
    setTimeout(resolve, ms);
  });
}

describe('test apollo', () => {
  const configServerUrl = 'http://someconfig.com';
  const appId = 'firstTest';


  beforeEach(async() => {
    nock.cleanAll();
    nock(`${configServerUrl}`)
    .persist()
    .get(`/configfiles/json/${appId}/default/application`)
    .reply(200, { test: false });

    nock(`${configServerUrl}`)
    .persist()
    .get(`/notifications/v2?appId=${appId}&cluster=default&notifications=0`)
    .reply(200, { test: false });
  });

  it('should get and cover config successfully', async () => {
    const apollo = new Apollo({
      configServerUrl,
      appId: 'firstTest',
      initialConfigs: {
        application: {
          test: true,
        },
      },
      listenOnNotification: false,
    });
    assert.equal(apollo.localCachedConfigs.application.test, true);
    assert(apollo.appId, appId);
    await sleep(2000);

    assert.equal(apollo.localCachedConfigs.application.test, false);
  });

  it('should get config', async () => {
    const apollo = new Apollo({
      configServerUrl,
      appId: 'firstTest',
      initialConfigs: {
        application: {
          test: true,
        },
      },
      listenOnNotification: false,
    });

    const result = apollo.fetchConfig({ key: 'test' });
    assert.equal(result, true);
  });

  it('should get configs', async () => {
    const apollo = new Apollo({
      configServerUrl,
      appId: 'firstTest',
      initialConfigs: {
        application: {
          test: true,
          rabbit: 'payment',
        },
      },
      listenOnNotification: false,
    });

    const result = apollo.fetchConfigs({ keys: ['test', 'rabbit'] });
    assert.equal(typeof result, 'object');
    assert.equal(result.test, true);
    assert.equal(result.rabbit, 'payment');
  });


  it('should refresh configs', async () => {
    const apollo = new Apollo({
      configServerUrl,
      appId: 'firstTest',
      initialConfigs: {
        application: {
          test: true,
          rabbit: 'payment',
        },
      },
      listenOnNotification: false,
    });

    const result1 = apollo.refreshConfigs({ configs: { test: false, rabbit: 'carrots' } });
    assert.equal(result1, true);
    const result2 = apollo.fetchConfigs({ keys: ['test', 'rabbit'] });
    assert.equal(result2.test, false);
    assert.equal(result2.rabbit, 'carrots');
  });

});
