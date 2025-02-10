import * as pulumi from '@pulumi/pulumi'

import './game-of-life'

const config = new pulumi.Config
const runAngularLaravelCms = config.getBoolean('run-angular-laravel-cms') ?? true

if (runAngularLaravelCms)
  import('./angular-laravel-cms')
