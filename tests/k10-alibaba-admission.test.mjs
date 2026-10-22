/**
 * K10: Keith 10-22 "admit Alibaba Cloud". The upload pin may be one exact Alibaba OSS bucket host, beside R2/S3/GCS.
 * 10-19 measured FacePhys presigning to an Alibaba OSS accelerate host; the exact production host is pinned by
 * reading the free preflight (K2), never guessed. Still one exact hostname: no bare endpoint, suffix or internal host.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { admittedUploadHost, readConfig, isReady } from '../lib/wellness/config.ts'
import { uploadHostAllowed } from '../lib/wellness/facephys.ts'

test('K10-01 an exact Alibaba OSS bucket host is an admitted pin: regional and accelerate endpoints', () => {
  for (const h of ['facephys-gateway-api.oss-accelerate.aliyuncs.com', 'facephys-kiosk.oss-ap-southeast-1.aliyuncs.com',
    'b01.oss-ap-southeast-3.aliyuncs.com', 'bucket.oss-cn-hangzhou.aliyuncs.com', 'bucket.oss-accelerate-overseas.aliyuncs.com']) {
    assert.equal(admittedUploadHost(h), true, h)
  }
})

test('K10-02 anything that is not one Alibaba bucket on a public OSS endpoint is refused', () => {
  for (const h of [
    'oss-accelerate.aliyuncs.com', 'oss-ap-southeast-1.aliyuncs.com', 'aliyuncs.com', // no bucket
    'bucket.oss-cn-hangzhou-internal.aliyuncs.com', // VPC-internal endpoint
    'a.b.oss-ap-southeast-1.aliyuncs.com', // a dotted "bucket" is not a bucket
    'bucket.oss-ap-southeast-1.aliyuncs.com.evil.example', 'bucket.oss-accelerate.aliyuncs.co', 'bucket.ecs.aliyuncs.com',
    'b.oss-accelerate.aliyuncs.com', // a bucket name is at least 3 characters
    '-bucket.oss-accelerate.aliyuncs.com', 'bucket-.oss-accelerate.aliyuncs.com', 'Bucket.oss-accelerate.aliyuncs.com',
  ]) assert.equal(admittedUploadHost(h), false, h)
})

test('K10-03 the R2/S3/GCS families Keith listed on 10-19 stay admitted', () => {
  for (const h of ['synthetic-bucket.s3.amazonaws.com', 'kiosk.s3.ap-southeast-1.amazonaws.com', 'acct.r2.cloudflarestorage.com', 'storage.googleapis.com']) {
    assert.equal(admittedUploadHost(h), true, h)
  }
})

const READY_ENV = {
  SCANS_ENABLED: '1', FACEPHYS_KEY_ID: 'k', FACEPHYS_SECRET_KEY: 's3cret', CALENDESK_API_KEY: 'cd', RESEND_API_KEY: 'rs',
  CONSENT_RETENTION_DAYS: '30', CONSENT_RETENTION_POLICY: 'dmk-30-days-v1',
}

test('K10-04 with an exact Alibaba pin the check can be ready; the pin admits that host only', () => {
  const c = readConfig({ ...READY_ENV, FACEPHYS_UPLOAD_HOSTS: 'facephys-gateway-api.oss-accelerate.aliyuncs.com' })
  assert.equal(isReady(c, true), true)
  assert.equal(uploadHostAllowed('https://facephys-gateway-api.oss-accelerate.aliyuncs.com/k/x.mp4?Signature=1', c.facephys), 'facephys-gateway-api.oss-accelerate.aliyuncs.com')
  assert.equal(uploadHostAllowed('https://other-bucket.oss-accelerate.aliyuncs.com/k/x.mp4', c.facephys), null, 'another bucket on the same endpoint')
  assert.equal(uploadHostAllowed('http://facephys-gateway-api.oss-accelerate.aliyuncs.com/k/x.mp4', c.facephys), null, 'never plaintext')
})

test('K10-05 two pins, or a bare Alibaba endpoint, keep the check off', () => {
  assert.equal(isReady(readConfig({ ...READY_ENV, FACEPHYS_UPLOAD_HOSTS: 'a01.oss-accelerate.aliyuncs.com,b01.oss-accelerate.aliyuncs.com' }), true), false)
  assert.equal(isReady(readConfig({ ...READY_ENV, FACEPHYS_UPLOAD_HOSTS: 'oss-accelerate.aliyuncs.com' }), true), false)
})
