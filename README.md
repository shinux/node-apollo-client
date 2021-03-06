# node-apollo-client [![Build Status][circleci-image]][circleci-url] [![NPM Version][npm-image]][npm-url] ![node](https://img.shields.io/node/v/node-apollo-client.svg?style=flat-square)

[circleci-image]: https://img.shields.io/circleci/build/github/shinux/node-apollo-client.svg?style=popout-square
[circleci-url]: https://circleci.com/gh/shinux/workflows/node-apollo-client

[npm-image]: https://img.shields.io/npm/v/node-apollo-client.svg?style=flat-square
[npm-url]: https://www.npmjs.com/package/node-apollo-client



node apollo client for Ctrip Apollo

Features:

1. implement all APIs described in [official documentation](https://github.com/ctripcorp/apollo/wiki/%E5%85%B6%E5%AE%83%E8%AF%AD%E8%A8%80%E5%AE%A2%E6%88%B7%E7%AB%AF%E6%8E%A5%E5%85%A5%E6%8C%87%E5%8D%97)
2. high availability by caching configs in local files which simulate JAVA SDK.
3. written in TypeScript and typing support
4. naturally async await function calling, no event or callback mixed-in.

## client logic and availability

```bash
local configs object
  \-+= local cached config files
    \-+= fetch from Apollo DB at once
      \-+= fetch from Apollo cache periodically (default to 5 minutes)
        \-+= subscribe notification and fetch from Apollo DB if release tag changed
          \-+= update local configs by API: refreshConfigs
```

|                                               scene |     impact| configs source                               |
| --------------------------------------------------: | --------- | -------------------------------------------- |
|                failed to connect apollo at begining | x         | load local configs directly                  |
|                            failed to connect apollo | x         | load cached apollo configs                   |
| failed to connect apollo and wish to update configs | x         | update cached configs temporarily            |
|                     failed to receive notifications | x         | fetch configs periodically from apollo       |
|                   failed to fetch from apollo cache | x         | subscribe notification and fetch from DB     |

## Usage

install package from npm

``` npm install node-apollo-client```


```javascript
const Apollo = require('node-apollo-client')

// Instantiate Apollo
const apollo = new Apollo({
  configServerUrl: 'your-config-server-url',
  appId: 'your-app-id',
  cluster: 'default', // [optional] default to `default`
  namespaces: ['application'],  // default to `['application']`, this is the namespaces that you want to use or maintain.
  initialConfigs: {
    application: {  // this is default namespace name
      foo: 'Mars',
      bar: 'Jupiter'
    },
  }, // [optional]
  listenOnNotification: true, // [optional] default to true
  fetchCacheInterval: 5 * 60e3, // [optional] default to 5 minutes. can be customize but 30s or shorter time are not acceptable.
  cachedConfigFilePath: '/tmp' // [optional] cached configs path, default to system's tmp directory, for linux it's basically '/tmp'.
});

// fetch single config
await apollo.fetchConfig({ key: 'foo' });
// return 'Mars'

// fetch multiple configs
await apollo.fetchConfigs({ keys: [ 'foo', 'bar' ] });
// return { foo: 'Mars', bar: 'Jupiter' }

// refresh local configs (merely used when Apollo is unavailable)
apollo.refreshConfigs({ configs: { foo: 'Mercury' } });
// check out key `foo`
await apollo.fetchConfig({ key: 'foo' });
// return { foo: 'Mercury' }
```


## License

MIT

