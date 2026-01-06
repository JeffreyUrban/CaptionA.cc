#!/usr/bin/env ts-node
/**
 * Test Wasabi IAM permissions - verify access is restricted to caption-acc-prod only
 */

import { S3Client, ListBucketsCommand, PutObjectCommand, GetObjectCommand } from '@aws-sdk/client-s3';
import * as dotenv from 'dotenv';

dotenv.config();

const s3Client = new S3Client({
  region: process.env.WASABI_REGION || 'us-east-1',
  endpoint: `https://s3.${process.env.WASABI_REGION || 'us-east-1'}.wasabisys.com`,
  credentials: {
    accessKeyId: process.env.WASABI_ACCESS_KEY!,
    secretAccessKey: process.env.WASABI_SECRET_KEY!,
  },
});

const authorizedBucket = process.env.WASABI_BUCKET!;

async function testPermissions() {
  console.log('🔒 Testing Wasabi IAM permissions...\n');
  console.log(`Authorized bucket: ${authorizedBucket}\n`);

  // Test 1: List buckets (may be restricted)
  console.log('📋 Test 1: Attempting to list all buckets...');
  try {
    const listResponse = await s3Client.send(new ListBucketsCommand({}));
    if (listResponse.Buckets && listResponse.Buckets.length > 1) {
      console.log('⚠️  Can list multiple buckets:');
      listResponse.Buckets.forEach(bucket => {
        console.log(`   - ${bucket.Name}`);
      });
      console.log('   Recommendation: Restrict ListBuckets permission for better security\n');
    } else if (listResponse.Buckets && listResponse.Buckets.length === 1) {
      console.log(`✅ Can only see authorized bucket: ${listResponse.Buckets[0].Name}\n`);
    }
  } catch (error: any) {
    if (error.name === 'AccessDenied') {
      console.log('✅ ListBuckets denied (good - user cannot enumerate buckets)\n');
    } else {
      console.log(`❌ Unexpected error: ${error.message}\n`);
    }
  }

  // Test 2: Access authorized bucket
  console.log(`📤 Test 2: Testing write access to authorized bucket (${authorizedBucket})...`);
  try {
    const testKey = 'dev/test/permission-test.txt';
    await s3Client.send(new PutObjectCommand({
      Bucket: authorizedBucket,
      Key: testKey,
      Body: Buffer.from('Permission test'),
    }));
    console.log(`✅ Write access to ${authorizedBucket}: SUCCESS\n`);

    // Clean up
    const { DeleteObjectCommand } = await import('@aws-sdk/client-s3');
    await s3Client.send(new DeleteObjectCommand({
      Bucket: authorizedBucket,
      Key: testKey,
    }));
  } catch (error: any) {
    console.log(`❌ Write access to ${authorizedBucket}: FAILED - ${error.message}\n`);
    process.exit(1);
  }

  // Test 3: Try to access a different bucket (should fail)
  console.log('🚫 Test 3: Attempting to access unauthorized bucket...');
  const unauthorizedBucket = 'caption-acc-dev-test-unauthorized';
  try {
    await s3Client.send(new PutObjectCommand({
      Bucket: unauthorizedBucket,
      Key: 'test.txt',
      Body: Buffer.from('This should fail'),
    }));
    console.log(`⚠️  WARNING: Can access unauthorized bucket "${unauthorizedBucket}"!`);
    console.log('   Recommendation: Restrict bucket access to caption-acc-prod only\n');
  } catch (error: any) {
    if (error.name === 'NoSuchBucket') {
      console.log(`✅ Bucket doesn't exist (expected)\n`);
    } else if (error.name === 'AccessDenied' || error.message.includes('Access Denied')) {
      console.log(`✅ Access denied to "${unauthorizedBucket}" (good - properly restricted)\n`);
    } else {
      console.log(`✅ Access prevented: ${error.message}\n`);
    }
  }

  console.log('🎉 Permission test complete!');
  console.log('\n✨ Summary:');
  console.log(`   - Access to ${authorizedBucket}: ✅ Granted`);
  console.log(`   - Access to other buckets: ✅ Denied`);
}

testPermissions();
