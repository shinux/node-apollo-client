
const Apollo = require('../dist/index');
const assert = require('assert');
const nock = require('nock');
const Bluebird = require('bluebird');
const fs = Bluebird.promisifyAll(require('fs'));

function sleep(ms) {
  return new Bluebird(resolve => {
    setTimeout(resolve, ms);
  });
}

function removeRelatedFile(appId) {
  const defaultFilePath = `/tmp/${appId}-nodeApolloCachedConfig.json`;
  if (fs.existsSync(defaultFilePath)) {
    return fs.unlinkSync(defaultFilePath);
  }
}

describe('test apollo', () => {
  const configServerUrl = 'http://172.17.96.136:8080';
  const appId = 'firstTest';
  const getFilePath = (_appId) => { return `/tmp/${_appId}-nodeApolloCachedConfig.json` };

  beforeEach(async() => {
    nock.cleanAll();

    nock(`${configServerUrl}`)
    .persist()
    .get(`/configfiles/json/${appId}/default/application`)
    .reply(200, { test: false });

    nock(`${configServerUrl}`)
    .persist()
    .get(`/configs/${appId}/default/application`)
    .reply(200, {
      appId,
      cluster: 'default',
      namespaceName: 'application',
      configurations: {
        test: false,
      },
      releseKey: '20xxxx',
    });

    nock(`${configServerUrl}`)
    .persist()
    .get(`/notifications/v2?appId=${appId}&cluster=default&notifications=0`)
    .reply(200, { test: false });
  });

  it('should get and cover config successfully', async () => {
    removeRelatedFile(appId);
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
    removeRelatedFile(appId);
  });

  it('should get config', async () => {
    removeRelatedFile(appId);
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
    const result = await apollo.fetchConfig({ key: 'test' });
    assert.equal(result, false);
    removeRelatedFile(appId);
  });

  it('should get configs', async () => {
    removeRelatedFile(appId);
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

    assert.equal(apollo.localCachedConfigs.application.test, true);
    const result = await apollo.fetchConfigs({ keys: ['test', 'rabbit'] });
    assert.equal(typeof result, 'object');
    assert.equal(result.test, false);
    assert.equal(result.rabbit, 'payment');
    removeRelatedFile(appId);
  });


  it('should refresh configs', async () => {
    removeRelatedFile(appId);
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

    const result1 = await apollo.refreshConfigs({ configs: { test: false, rabbit: 'carrots' } });
    assert.equal(result1, true);
    const result2 = await apollo.fetchConfigs({ keys: ['test', 'rabbit'] });
    assert.equal(result2.test, false);
    assert.equal(result2.rabbit, 'carrots');

    sleep(500);
    const targetFile = await fs.readFileAsync(getFilePath(appId), 'utf8');

    assert.equal(JSON.parse(targetFile).configs.application.rabbit, 'carrots');
    removeRelatedFile(appId);
  });

  it('test save configs into /tmp', async () => {
    removeRelatedFile(appId);
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

    await sleep(2000);

    const targetFile = await fs.readFileAsync(getFilePath(appId), 'utf8');

    assert.equal(JSON.parse(targetFile).configs.application.test, false);
  });

  it('test configs influenced by saved file', async () => {
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

    await sleep(500);

    assert.equal(apollo.localCachedConfigs.application.test, false);

    await sleep(2000);

    const targetFile = await fs.readFileAsync(getFilePath(appId), 'utf8');

    assert.equal(JSON.parse(targetFile).configs.application.test, false);
    removeRelatedFile(appId);
  });
});
