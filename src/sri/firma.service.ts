// firma.service.ts
import { Injectable } from '@nestjs/common';
import * as forge from 'node-forge';
import * as crypto from 'crypto';
import * as fs from 'fs';

@Injectable()
export class FirmaService {

	firmarXml(xmlString: string, p12Path: string, pass: string): string {
		const cleanXml = xmlString.replace(/^\uFEFF/, '').trim();

		const p12Buffer = fs.readFileSync(p12Path);
		const p12Asn1 = forge.asn1.fromDer(p12Buffer.toString('binary'));
		const p12 = forge.pkcs12.pkcs12FromAsn1(p12Asn1, false, pass);

		const keyBags = p12.getBags({ bagType: forge.pki.oids.pkcs8ShroudedKeyBag });
		const keyBag = keyBags[forge.pki.oids.pkcs8ShroudedKeyBag]?.[0];
		if (!keyBag?.key) throw new Error('No se encontró la clave privada en el .p12');
		const privateKeyPem = forge.pki.privateKeyToPem(keyBag.key);

		const certBags = p12.getBags({ bagType: forge.pki.oids.certBag });
		const certBag = certBags[forge.pki.oids.certBag]?.[0];
		if (!certBag?.cert) throw new Error('No se encontró el certificado en el .p12');
		const cert = certBag.cert;
		const certPem = forge.pki.certificateToPem(cert);

		const certBase64 = certPem
			.replace(/-----BEGIN CERTIFICATE-----|-----END CERTIFICATE-----|\r|\n/g, '')
			.trim();

		const certDer = forge.asn1.toDer(forge.pki.certificateToAsn1(cert)).getBytes();
		const certDigestBase64 = forge.util.encode64(
			forge.md.sha1.create().update(certDer).digest().getBytes()
		);

		const publicKey = cert.publicKey as forge.pki.rsa.PublicKey;
		const modulusHex = publicKey.n.toString(16);
		const modulusB64 = forge.util.encode64(forge.util.hexToBytes(modulusHex.length % 2 ? '0' + modulusHex : modulusHex));
		const exponentHex = publicKey.e.toString(16);
		const exponentB64 = forge.util.encode64(forge.util.hexToBytes(exponentHex.length % 2 ? '0' + exponentHex : exponentHex));

		const issuerName = cert.issuer.attributes.map((a) => `${a.shortName}=${a.value}`).reverse().join(',');
		const serialNumber = parseInt(cert.serialNumber, 16).toString();

		const randomId = () => Math.floor(Math.random() * 1000000).toString();
		const sigId = `Signature${randomId()}`;
		const signedInfoId = `Signature-SignedInfo${randomId()}`;
		const sigValueId = `SignatureValue${randomId()}`;
		const certId = `Certificate${randomId()}`;
		const refPropsId = `SignedPropertiesID${randomId()}`;
		const refDocId = `Reference-ID-${randomId()}`;
		const objectId = `${sigId}-Object${randomId()}`;
		const signedPropsId = `${sigId}-SignedProperties${randomId()}`;

		const now = new Date();
		const pad = (n: number) => n.toString().padStart(2, '0');
		const offset = -now.getTimezoneOffset();
		const offsetSign = offset >= 0 ? '+' : '-';
		const offsetH = pad(Math.floor(Math.abs(offset) / 60));
		const offsetM = pad(Math.abs(offset) % 60);
		const signingTime = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}` +
			`T${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}${offsetSign}${offsetH}:${offsetM}`;

		const docDigest = crypto.createHash('sha1').update(cleanXml, 'utf8').digest('base64');

		const signedPropertiesXml =
			`<etsi:SignedProperties Id="${signedPropsId}">` +
			`<etsi:SignedSignatureProperties>` +
			`<etsi:SigningTime>${signingTime}</etsi:SigningTime>` +
			`<etsi:SigningCertificate>` +
			`<etsi:Cert>` +
			`<etsi:CertDigest>` +
			`<ds:DigestMethod Algorithm="http://www.w3.org/2000/09/xmldsig#sha1"></ds:DigestMethod>` +
			`<ds:DigestValue>${certDigestBase64}</ds:DigestValue>` +
			`</etsi:CertDigest>` +
			`<etsi:IssuerSerial>` +
			`<ds:X509IssuerName>${issuerName}</ds:X509IssuerName>` +
			`<ds:X509SerialNumber>${serialNumber}</ds:X509SerialNumber>` +
			`</etsi:IssuerSerial>` +
			`</etsi:Cert>` +
			`</etsi:SigningCertificate>` +
			`</etsi:SignedSignatureProperties>` +
			`<etsi:SignedDataObjectProperties>` +
			`<etsi:DataObjectFormat ObjectReference="#${refDocId}">` +
			`<etsi:Description>contenido comprobante</etsi:Description>` +
			`<etsi:MimeType>text/xml</etsi:MimeType>` +
			`</etsi:DataObjectFormat>` +
			`</etsi:SignedDataObjectProperties>` +
			`</etsi:SignedProperties>`;

		const signedPropsDigest = crypto.createHash('sha1').update(signedPropertiesXml, 'utf8').digest('base64');

		const keyInfoXml =
			`<ds:KeyInfo Id="${certId}">` +
			`<ds:X509Data>` +
			`<ds:X509Certificate>${certBase64}</ds:X509Certificate>` +
			`</ds:X509Data>` +
			`<ds:KeyValue>` +
			`<ds:RSAKeyValue>` +
			`<ds:Modulus>${modulusB64}</ds:Modulus>` +
			`<ds:Exponent>${exponentB64}</ds:Exponent>` +
			`</ds:RSAKeyValue>` +
			`</ds:KeyValue>` +
			`</ds:KeyInfo>`;

		const certRefDigest = crypto.createHash('sha1').update(keyInfoXml, 'utf8').digest('base64');

		const signedInfoXml =
			`<ds:SignedInfo Id="${signedInfoId}">` +
			`<ds:CanonicalizationMethod Algorithm="http://www.w3.org/TR/2001/REC-xml-c14n-20010315"></ds:CanonicalizationMethod>` +
			`<ds:SignatureMethod Algorithm="http://www.w3.org/2000/09/xmldsig#rsa-sha1"></ds:SignatureMethod>` +
			`<ds:Reference Id="${refPropsId}" Type="http://uri.etsi.org/01903#SignedProperties" URI="#${signedPropsId}">` +
			`<ds:DigestMethod Algorithm="http://www.w3.org/2000/09/xmldsig#sha1"></ds:DigestMethod>` +
			`<ds:DigestValue>${signedPropsDigest}</ds:DigestValue>` +
			`</ds:Reference>` +
			`<ds:Reference URI="#${certId}">` +
			`<ds:DigestMethod Algorithm="http://www.w3.org/2000/09/xmldsig#sha1"></ds:DigestMethod>` +
			`<ds:DigestValue>${certRefDigest}</ds:DigestValue>` +
			`</ds:Reference>` +
			`<ds:Reference Id="${refDocId}" URI="#comprobante">` +
			`<ds:Transforms>` +
			`<ds:Transform Algorithm="http://www.w3.org/2000/09/xmldsig#enveloped-signature"></ds:Transform>` +
			`</ds:Transforms>` +
			`<ds:DigestMethod Algorithm="http://www.w3.org/2000/09/xmldsig#sha1"></ds:DigestMethod>` +
			`<ds:DigestValue>${docDigest}</ds:DigestValue>` +
			`</ds:Reference>` +
			`</ds:SignedInfo>`;

		const sign = crypto.createSign('RSA-SHA1');
		sign.update(signedInfoXml, 'utf8');
		const signatureValue = sign.sign(privateKeyPem, 'base64');

		const signatureXml =
			`<ds:Signature xmlns:ds="http://www.w3.org/2000/09/xmldsig#" xmlns:etsi="http://uri.etsi.org/01903/v1.3.2#" Id="${sigId}">` +
			signedInfoXml +
			`<ds:SignatureValue Id="${sigValueId}">${signatureValue}</ds:SignatureValue>` +
			keyInfoXml +
			`<ds:Object Id="${objectId}">` +
			`<etsi:QualifyingProperties Target="#${sigId}">` +
			signedPropertiesXml +
			`</etsi:QualifyingProperties>` +
			`</ds:Object>` +
			`</ds:Signature>`;

		const rootCloseTagMatch = cleanXml.match(/<\/([a-zA-Z0-9_:-]+)\s*>$/);
		if (!rootCloseTagMatch) throw new Error('No se encontró el tag de cierre del elemento raíz');
		const rootCloseTag = rootCloseTagMatch[0];

		return cleanXml.replace(new RegExp(`${rootCloseTag}$`), `${signatureXml}${rootCloseTag}`);
	}
}