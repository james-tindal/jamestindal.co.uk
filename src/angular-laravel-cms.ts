import * as pulumi from '@pulumi/pulumi'
import * as aws from '@pulumi/aws'
import * as tls from '@pulumi/tls'

const gitRepoUrl = 'https://github.com/james-tindal/angular-laravel-cms/'
const gitBranch = 'master'

const tags = { project: 'angular-laravel-cms.jamestindal.co.uk' }

// Create a new RSA key pair
const rsaKeyPair = new tls.PrivateKey('rsa-keypair', { algorithm: 'RSA' })

// cli command to show private key: exportPemFile=true pulumi preview
export const privateKeyPem = process.env.exportPemFile && pulumi.unsecret(rsaKeyPair.privateKeyPem)
export const privateKeyOpenssh = process.env.exportPemFile && pulumi.unsecret(rsaKeyPair.privateKeyOpenssh)

// EC2 Key Pair
const awsKeyPair = new aws.ec2.KeyPair('angular-laravel-cms-ssh-key-pair', {
  publicKey: rsaKeyPair.publicKeyOpenssh, tags })

// User data script
const userDataScript = `#!/bin/bash
# log to system log
exec > >(tee /var/log/user-data.log|logger -t user-data -s 2>/dev/console) 2>&1
yum update -y
yum install -y docker git
service docker start
usermod -a -G docker ec2-user

# Install Docker Compose manually
curl -SL https://github.com/docker/compose/releases/download/v2.28.1/docker-compose-linux-x86_64 \
  --create-dir -o /usr/local/lib/docker/cli-plugins/docker-compose
chmod +x /usr/local/lib/docker/cli-plugins/docker-compose

cd /home/ec2-user
git clone -b ${gitBranch} ${gitRepoUrl} repo
cd repo
docker compose build
docker compose up
`

// EC2 VPC
const vpc = new aws.ec2.Vpc('my-vpc', {
  cidrBlock: '10.0.0.0/16',
  enableDnsSupport: true,
  enableDnsHostnames: true,
  tags,
})

// EC2 Internet Gateway
const internetGateway = new aws.ec2.InternetGateway('my-igw', {
  vpcId: vpc.id,
  tags,
})

// EC2 Route Table
const routeTable = new aws.ec2.RouteTable('my-route-table', {
  vpcId: vpc.id,
  routes: [{ cidrBlock: '0.0.0.0/0', gatewayId: internetGateway.id }],
  tags,
})

// EC2 Subnet
const subnet = new aws.ec2.Subnet('my-subnet', {
  vpcId: vpc.id,
  cidrBlock: '10.0.1.0/24',
  tags,
})

new aws.ec2.RouteTableAssociation('subnet-route-table-association', {
  subnetId: subnet.id,
  routeTableId: routeTable.id,
})

// EC2 Security Group
const secGroup = new aws.ec2.SecurityGroup('web-secgrp', {
  vpcId: vpc.id,
  description: 'Enable HTTP access',
  ingress: [
    { protocol: 'tcp', fromPort: 22, toPort: 22, cidrBlocks: ['0.0.0.0/0'] },
    { protocol: 'tcp', fromPort: 80, toPort: 80, cidrBlocks: ['0.0.0.0/0'] },
  ],
  egress: [
    { protocol: '-1', fromPort: 0, toPort: 0, cidrBlocks: ['0.0.0.0/0'] }, // Allow all outbound traffic
  ],
  tags,
})

// EC2 instance
const server = new aws.ec2.Instance('web-server', {
  instanceType: 't3a.nano',
  vpcSecurityGroupIds: [secGroup.id],
  subnetId: subnet.id,
  userData: userDataScript,
  ami: 'ami-026b2ae0ba2773e0a',
  keyName: awsKeyPair.keyName,
  tags,
})

// EC2 Elastic IP
const eip = new aws.ec2.Eip('web-server-eip', {
  instance: server.id,
  tags,
})



// Cloudfront Cache Policy
const cachePolicy = new aws.cloudfront.CachePolicy('angular-laravel-cms-cache-policy', {
  defaultTtl: 3600,
  maxTtl: 86400,
  minTtl: 0,
  parametersInCacheKeyAndForwardedToOrigin: {
    cookiesConfig: {
      cookieBehavior: 'all', // Forward all cookies
    },
    headersConfig: {
      headerBehavior: 'whitelist',
      headers: { items: ['Authorization', 'Set-Cookie'] }, // List headers to include in cache key
    },
    queryStringsConfig: {
      queryStringBehavior: 'all', // Forward all query strings if needed
    },
  },
});

// Cloudfront Origin Request Policy
const originRequestPolicy = new aws.cloudfront.OriginRequestPolicy('angular-laravel-cms-origin-request-policy', {
  cookiesConfig: {
    cookieBehavior: 'all', // Forward all cookies to origin
  },
  headersConfig: {
    headerBehavior: 'whitelist',
    headers: { items: ['Set-Cookie'] }, // Forward necessary headers to origin
  },
  queryStringsConfig: {
    queryStringBehavior: 'all', // Forward all query strings to origin
  },
});

// Cloudfront Distribution
const cloudFrontDistribution = new aws.cloudfront.Distribution('angular-laravel-cms-distribution', {
  origins: [{
    domainName: eip.publicDns,
    originId: 'angular-laravel-cms-origin',
    customOriginConfig: {
      httpPort: 80,
      httpsPort: 443,
      originProtocolPolicy: 'http-only',
      originSslProtocols: ['TLSv1.2']
    },
  }],
  enabled: true,
  isIpv6Enabled: true,
  aliases: ['angular-laravel-cms.jamestindal.co.uk'],
  defaultCacheBehavior: {
    targetOriginId: 'angular-laravel-cms-origin',
    viewerProtocolPolicy: 'redirect-to-https',
    allowedMethods: ['HEAD', 'DELETE', 'POST', 'GET', 'OPTIONS', 'PUT', 'PATCH'],
    cachedMethods: ['GET', 'HEAD'],
    cachePolicyId: cachePolicy.id,
    originRequestPolicyId: originRequestPolicy.id,
  },
  priceClass: 'PriceClass_100',
  restrictions: {
    geoRestriction: { restrictionType: 'none' },
  },
  viewerCertificate: {
    acmCertificateArn: 'arn:aws:acm:us-east-1:847878441446:certificate/31a99a45-5e60-4779-a8ef-bd7c6aa0bde2',
    sslSupportMethod: 'sni-only',
    minimumProtocolVersion: 'TLSv1.2_2021',
  },
  tags,
});




const hostedZone = await aws.route53.getZone({ name: 'jamestindal.co.uk' })
const subdomain = 'angular-laravel-cms.jamestindal.co.uk'

const dnsRecord = new aws.route53.Record('web-server-dns-record', {
  zoneId: hostedZone.id,
  name: subdomain,
  type: 'A',
  aliases: [{
    name: cloudFrontDistribution.domainName,
    zoneId: cloudFrontDistribution.hostedZoneId,
    evaluateTargetHealth: false,
  }],
})
