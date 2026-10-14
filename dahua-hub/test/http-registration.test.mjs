import assert from 'node:assert/strict';
import test from 'node:test';
import { ProtocolError, parseHttpRequest, readRegistration } from '../src/registration/http-registration.mjs';
import { registrationRequest } from './helpers.mjs';

test('lee el registro Auto Register con el DeviceID en el cuerpo JSON', () => {
  const parsed = parseHttpRequest(Buffer.from(registrationRequest('PROP-0001')));
  assert.equal(parsed.request.method, 'POST');
  assert.equal(parsed.rest.length, 0);
  const registration = readRegistration(parsed.request);
  assert.equal(registration.registrationId, 'PROP-0001');
  assert.equal(registration.deviceClass, 'AccessControl');
  assert.equal(registration.serverIp, '203.0.113.10');
  assert.equal(registration.path, '/cgi-bin/api/autoRegist/connect');
});

test('espera más bytes si el registro llega partido y conserva lo que sobra', () => {
  const full = Buffer.from(`${registrationRequest('PROP-0002')}EXTRA`);
  assert.equal(parseHttpRequest(full.subarray(0, 20)), null);
  assert.equal(parseHttpRequest(full.subarray(0, full.length - 10)), null);
  const parsed = parseHttpRequest(full);
  assert.equal(parsed.rest.toString(), 'EXTRA');
  assert.equal(readRegistration(parsed.request).registrationId, 'PROP-0002');
});

test('acepta el identificador en la URL o en una cabecera', () => {
  const byQuery = parseHttpRequest(Buffer.from('GET /cgi-bin/api/autoRegist/connect?DeviceID=PROP-0003 HTTP/1.1\r\n\r\n'));
  assert.equal(readRegistration(byQuery.request).registrationId, 'PROP-0003');
  const byHeader = parseHttpRequest(Buffer.from('POST /connect HTTP/1.1\r\nX-Device-ID: PROP-0004\r\n\r\n'));
  assert.equal(readRegistration(byHeader.request).registrationId, 'PROP-0004');
});

test('rechaza conexiones que no son HTTP (protocolo privado) y IDs inválidos', () => {
  assert.throws(() => parseHttpRequest(Buffer.from([0xa0, 0x00, 0x00, 0x60, 0x01])),
    (error) => error instanceof ProtocolError && error.code === 'PROTOCOLO_NO_HTTP');
  const noId = parseHttpRequest(Buffer.from('POST /connect HTTP/1.1\r\nContent-Length: 2\r\n\r\n{}'));
  assert.throws(() => readRegistration(noId.request), (error) => error.code === 'SIN_REGISTRATION_ID');
  const badId = parseHttpRequest(Buffer.from(registrationRequest('PROP 0001; DROP')));
  assert.throws(() => readRegistration(badId.request), (error) => error.code === 'REGISTRATION_ID_INVALIDO');
});
