import * as pulumi from '@pulumi/pulumi'
import * as aws from '@pulumi/aws'

const config = new pulumi.Config()

const githubRepo = 'james-tindal/game-of-life'
const githubToken = config.requireSecret('github-access-token')

const amplifyApp = new aws.amplify.App('amplify-game-of-life', {
  name: `game-of-life.jamestindal.co.uk`,
  repository: `https://github.com/${githubRepo}`,
  accessToken: githubToken,
  buildSpec: `
    version: 1
    frontend:
      artifacts:
        baseDirectory: src
        files:
          - '**/*'
  `
})

const mainBranch = new aws.amplify.Branch('amplify main branch', {
  appId: amplifyApp.id,
  branchName: 'main'
})

const domainAssociation = new aws.amplify.DomainAssociation('domain association', {
  appId: amplifyApp.id,
  domainName: 'jamestindal.co.uk',
  subDomains: [{
    branchName: mainBranch.branchName,
    prefix: 'game-of-life',
  }],
  waitForVerification: true
})

export const amplifyAppId = domainAssociation.id
