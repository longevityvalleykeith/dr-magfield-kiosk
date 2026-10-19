import { test } from 'node:test'
import assert from 'node:assert/strict'
import { KioskController } from '../lib/wellness/controller.ts'
test('RT06 hiding while camera permission is pending cancels the future camera stream',async()=>{
  let release;const media={on:false,supported:()=>true,open(){return new Promise(r=>{release=()=>{this.on=true;r()}})},close(){this.on=false},isOpen(){return this.on},async record(){throw new Error('not used')}}
  const api={booking:async()=>({status:200,body:{status:'matched',attemptToken:'synthetic-attempt',maskedEmail:'s•••@example.invalid',care:null,scanSeconds:10}})}
  const c=new KioskController({api,media,scanSeconds:10});c.start();await c.submitBooking('501','synthetic@example.invalid');c.setConsent('processing',true);c.setConsent('emailResults',true)
  const pending=c.acceptConsent();assert.equal(typeof release,'function');c.onHidden();release();await pending
  assert.equal(media.isOpen(),false,'Hidden page accepted the delayed camera stream and left the camera open')
  assert.notEqual(c.state.screen,'camera')
})
