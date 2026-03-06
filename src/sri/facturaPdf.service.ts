import { Injectable, Logger } from '@nestjs/common';
import * as fs from 'fs';
import * as path from 'path';

@Injectable()
export class FacturaPdfService {

	private readonly logger = new Logger(FacturaPdfService.name);

	private readonly PDF_DIR = process.env.PDF_FACTURAS_DIR || 'C:\\Users\\ASUS\\OneDrive\\Desktop\\facturasPdf';  // Cambia esta ruta según tu entorno
	private readonly TEMPLATE_PATH = process.env.FACTURA_TEMPLATE || path.join(__dirname, '..', '..', 'templates', 'factura.template.html');
	private readonly LOGO_PATH = process.env.LOGO_PATH || path.join(process.cwd(), 'src', 'img', 'logo-privilegio.png');  // ruta al logo en base64 o imagen

	// ── Punto de entrada principal ─────────────────────────────────────────────
	async generarDesdeXml(xmlFirmado: string, nombreDoc: string, numeroAutorizacion?: string, fechaAutorizacion?: string): Promise<string> {
		const datos = this.parsearXml(xmlFirmado, numeroAutorizacion, fechaAutorizacion);
		return this.generarPdf(datos, nombreDoc);
	}

	// ── Parsear XML y extraer todos los datos ──────────────────────────────────
	private parsearXml(xml: string, numeroAutorizacion?: string, fechaAutorizacion?: string): Record<string, any> {
		const get = (tag: string): string => xml.match(new RegExp(`<${tag}[^>]*>([^<]+)<\/${tag}>`))?.[1]?.trim() || '';
		const getAll = (tag: string): string[] => [...xml.matchAll(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\/${tag}>`, 'g'))].map(m => m[1]);

		// Ambiente y tipo emisión
		const ambienteCod = get('ambiente');
		const tipoEmisionCod = get('tipoEmision');
		const ambiente = ambienteCod === '2' ? 'PRODUCCION' : 'PRUEBAS';
		const tipoEmision = tipoEmisionCod === '1' ? 'NORMAL' : 'CONTINGENCIA';

		// IVA total
		const totalImpuestosRaw = getAll('totalImpuesto');
		let totalIva = '0.00';
		for (const ti of totalImpuestosRaw) {
			const cod = ti.match(/<codigo>([^<]+)<\/codigo>/)?.[1]?.trim();
			if (cod === '2') {
				totalIva = ti.match(/<valor>([^<]+)<\/valor>/)?.[1]?.trim() || '0.00';
			}
		}

		// Detalles
		const detallesRaw = getAll('detalle');
		const detalles = detallesRaw.map(d => {
			const g = (tag: string) => d.match(new RegExp(`<${tag}>([^<]+)<\/${tag}>`))?.[1]?.trim() || '';
			return {
				codigoPrincipal: g('codigoInterno') || g('codigoPrincipal'),
				codigoAuxiliar: g('codigoAuxiliar'),
				descripcion: g('descripcion'),
				cantidad: g('cantidad'),
				precioUnitario: g('precioUnitario'),
				descuento: g('descuento'),
				precioTotalSinImpuesto: g('precioTotalSinImpuesto'),
			};
		});

		// Info adicional
		const infoAdicional: { nombre: string; valor: string }[] = [];
		const campos = [...xml.matchAll(/<campoAdicional nombre="([^"]+)">([^<]*)<\/campoAdicional>/g)];
		for (const m of campos) {
			infoAdicional.push({ nombre: m[1], valor: m[2] });
		}

		// Totales por tipo de IVA
		const subtotal15 = get('totalSinImpuestos');
		const totalDescuento = parseFloat(get('totalDescuento') || '0').toFixed(2);
		const importeTotal = get('importeTotal') || get('valorModificacion');

		// Fecha autorización — formatear si viene como ISO
		let fechaAutStr = fechaAutorizacion || get('fechaAutorizacion') || '';
		if (fechaAutStr.includes('T')) {
			const d = new Date(fechaAutStr);
			const pad = (n: number) => n.toString().padStart(2, '0');
			fechaAutStr = `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
		}

		return {
			// Emisor
			razonSocial: get('razonSocial'),
			ruc: get('ruc'),
			dirMatriz: get('dirMatriz'),
			dirEstablecimiento: get('dirEstablecimiento'),
			contribuyenteEspecial: get('contribuyenteEspecial'),
			obligadoContabilidad: get('obligadoContabilidad'),
			// Documento
			ambiente,
			tipoEmision,
			codDoc: get('codDoc'),
			estab: get('estab'),
			ptoEmi: get('ptoEmi'),
			secuencial: get('secuencial'),
			claveAcceso: get('claveAcceso'),
			numeroAutorizacion: numeroAutorizacion || get('claveAcceso'),
			fechaAutorizacion: fechaAutStr,
			fechaEmision: get('fechaEmision'),
			// Comprador
			razonSocialComprador: get('razonSocialComprador'),
			identificacionComprador: get('identificacionComprador'),
			direccionComprador: get('direccionComprador'),
			guiaRemision: get('guiaRemision') || '',
			// Totales
			subtotal15,
			totalDescuento,
			totalIva,
			importeTotal,
			// Detalles e info adicional
			detalles,
			infoAdicional,
		};
	}

	// ── Generar PDF usando Puppeteer ──────────────────────────────────────────
	private async generarPdf(datos: Record<string, any>, claveAcceso: string): Promise<string> {
		if (!fs.existsSync(this.PDF_DIR)) {
			fs.mkdirSync(this.PDF_DIR, { recursive: true });
		}

		const rutaPdf = path.join(this.PDF_DIR, `${claveAcceso}.pdf`);
		const html = this.renderTemplate(datos);

		try {
			// Puppeteer — instalar con: npm install puppeteer
			const puppeteer = require('puppeteer');
			const browser = await puppeteer.launch({
				headless: true,
				args: ['--no-sandbox', '--disable-setuid-sandbox'],
			});
			const page = await browser.newPage();
			await page.setContent(html, { waitUntil: 'networkidle0' });
			await page.pdf({
				path: rutaPdf,
				format: 'A4',
				margin: { top: '8mm', right: '8mm', bottom: '8mm', left: '8mm' },
				printBackground: true,
			});
			await browser.close();
		} catch (e: any) {
			// Fallback: guardar HTML si puppeteer no está disponible
			const rutaHtml = rutaPdf.replace('.pdf', '.html');
			fs.writeFileSync(rutaHtml, html, 'utf8');
			return rutaHtml;
		}

		return rutaPdf;
	}

	// ── Renderizar plantilla HTML sustituyendo variables ──────────────────────
	private renderTemplate(datos: Record<string, any>): string {

		const barcodeBase64 = this.generarBarcodeBase64(datos.claveAcceso);

		// Leer plantilla
		let html: string;
		if (fs.existsSync(this.TEMPLATE_PATH)) {
			html = fs.readFileSync(this.TEMPLATE_PATH, 'utf8');
		} else {
			// Plantilla embebida como fallback
			html = this.getTemplateEmbebida();
		}

		// Logo en base64
		let logoBase64 = '';
		if (this.LOGO_PATH && fs.existsSync(this.LOGO_PATH)) {
			const ext = path.extname(this.LOGO_PATH).slice(1).toLowerCase();
			const mime = ext === 'jpg' ? 'jpeg' : ext;
			logoBase64 = `data:image/${mime};base64,` + fs.readFileSync(this.LOGO_PATH).toString('base64');
		}

		// Filas de detalles
		const detallesRows = datos.detalles.map((d: any) => `
      <tr>
        <td>${this.esc(d.codigoPrincipal)}</td>
        <td class="ctr">${this.esc(d.cantidad)}</td>
        <td>${this.esc(d.descripcion)}</td>
        <td class="num">${this.fmt(d.precioUnitario)}</td>
        <td class="num">${this.fmt(d.descuento)}</td>
        <td class="num">${this.fmt(d.precioTotalSinImpuesto)}</td>
      </tr>`).join('');

		// Filas de info adicional
		const infoAdicionalRows = datos.infoAdicional.map((i: any) => `
      <tr>
        <td>${this.esc(i.nombre)}</td>
        <td>${this.esc(i.valor)}</td>
      </tr>`).join('');

		// Filas de totales
		const totalesRows = [
			{ label: 'SUBTOTAL 15%', valor: datos.subtotal15, bold: false },
			{ label: 'SUBTOTAL IVA 0%', valor: '0.00', bold: false },
			{ label: 'SUBTOTAL NO OBJETO DE IVA', valor: '0.00', bold: false },
			{ label: 'SUBTOTAL EXENTO DE IVA', valor: '0.00', bold: false },
			{ label: 'SUBTOTAL SIN IMPUESTOS', valor: datos.subtotal15, bold: false },
			{ label: 'TOTAL DESCUENTO', valor: datos.totalDescuento, bold: false },
			{ label: 'ICE', valor: '0.00', bold: false },
			{ label: 'IVA 15%', valor: datos.totalIva, bold: false },
			{ label: 'TOTAL DEVOLUCION IVA', valor: '0.00', bold: false },
			{ label: 'IRBPNR', valor: '0.00', bold: false },
			{ label: 'PROPINA', valor: '0.00', bold: false },
			{ label: 'VALOR TOTAL', valor: datos.importeTotal, bold: true },
		].map(t => `
      <tr${t.bold ? ' class="total-final"' : ''}>
        <td>${t.label}</td>
        <td>${this.fmt(t.valor)}</td>
      </tr>`).join('');

		// Pie de página opcional
		const piePagina = datos.piePagina || '';

		const tiposDocumento = {
			'01': 'FACTURA',
			'04': 'NOTA DE CRÉDITO',
		};

		// Reemplazar todas las variables {{variable}}
		const vars: Record<string, string> = {
			razonSocial: datos.razonSocial,
			ruc: datos.ruc,
			tipoDoc: tiposDocumento[datos.codDoc] || 'FACTURA',
			dirMatriz: datos.dirMatriz,
			dirEstablecimiento: datos.dirEstablecimiento,
			contribuyenteEspecial: datos.contribuyenteEspecial,
			obligadoContabilidad: datos.obligadoContabilidad,
			ambiente: datos.ambiente,
			tipoEmision: datos.tipoEmision,
			estab: datos.estab,
			ptoEmi: datos.ptoEmi,
			secuencial: datos.secuencial,
			claveAcceso: datos.claveAcceso,
			numeroAutorizacion: datos.numeroAutorizacion,
			fechaAutorizacion: datos.fechaAutorizacion,
			fechaEmision: datos.fechaEmision,
			razonSocialComprador: datos.razonSocialComprador,
			identificacionComprador: datos.identificacionComprador,
			direccionComprador: datos.direccionComprador,
			guiaRemision: datos.guiaRemision,
			logoBase64: logoBase64,
			detallesRows,
			infoAdicionalRows,
			totalesRows,
			piePagina,
			barcodeBase64,
		};

		// Reemplazar {{var}} simples
		for (const [key, val] of Object.entries(vars)) {
			html = html.replace(new RegExp(`{{${key}}}`, 'g'), val || '');
		}

		// Reemplazar bloques {{#if var}}...{{/if}}
		html = html.replace(/{{#if (\w+)}}([\s\S]*?){{\/if}}/g, (_, key, content) => {
			return vars[key] ? content : '';
		});

		return html;
	}

	// ── Helpers ───────────────────────────────────────────────────────────────
	private esc(s: string): string {
		return (s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
	}

	private fmt(n: string | number): string {
		const num = parseFloat(String(n) || '0');
		if (isNaN(num)) return String(n);
		return num.toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
	}

	// ── Plantilla embebida (fallback si no encuentra el archivo) ──────────────
	private getTemplateEmbebida(): string {
		// Retorna la plantilla HTML completa como string
		// (pega aquí el contenido de factura.template.html si no usas archivo externo)
		return fs.readFileSync(
			path.join(process.cwd(), 'templates', 'factura.template.html'),
			'utf8'
		);
	}

	private generarBarcodeBase64(texto: string): string {
		try {
			const JsBarcode = require('jsbarcode');
			const { createCanvas } = require('canvas');
			const canvas = createCanvas(600, 80);
			JsBarcode(canvas, texto, {
				format: 'CODE128',
				width: 1.5,
				height: 50,
				displayValue: false,
				margin: 5,
			});
			return canvas.toDataURL('image/png').replace('data:image/png;base64,', '');
		} catch (e: any) {
			this.logger.error(`Error generando barcode: ${e.message}`);
			return '';
		}
	}
}