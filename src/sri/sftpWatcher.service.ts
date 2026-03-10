import { Injectable, Logger, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { SftpService } from './sftp.service';
import { SftpProcesadorService } from './sftpProcesador.service';

@Injectable()
export class SftpWatcherService implements OnModuleInit, OnModuleDestroy {

	private readonly logger = new Logger(SftpWatcherService.name);
	private procesando = false;
	private archivosConocidos = new Set<string>();
	private readonly INTERVALO_MS = parseInt(process.env.SFTP_WATCH_INTERVAL_MS || '30000');

	// Estadísticas
	private stats = {
		totalDetectados: 0,
		totalAutorizados: 0,
		totalErrores: 0,
		ultimaRevision: null as Date | null,
		ultimoProcesado: null as string | null,
	};

	constructor(
		private readonly sftpService: SftpService,
		private readonly sftpProcesadorService: SftpProcesadorService,
	) { }

	onModuleInit() {
		this.logger.log(`🚀 SFTP Watcher iniciado — revisando cada ${this.INTERVALO_MS / 1000}s`);
		setTimeout(() => this.verificarNuevosArchivos(), 5000);
	}

	onModuleDestroy() {
		this.logger.log('SFTP Watcher detenido');
	}

	// ── Revisar cada 30 segundos ──────────────────────────────────────────────
	@Cron(CronExpression.EVERY_30_SECONDS)
	async verificarNuevosArchivos(): Promise<void> {
		if (this.procesando) {
			this.logger.debug('Proceso en curso, saltando revisión...');
			return;
		}

		this.stats.ultimaRevision = new Date();

		try {
			// Verificar conexión antes de listar
			const conectado = await this.sftpService.verificarConexion();
			if (!conectado) {
				this.logger.warn('⚠ SFTP no disponible — verifica la VPN. Reintentará en el próximo ciclo.');
				return;  // ← salir limpiamente sin afectar nada más
			}

			const archivosActuales = await this.sftpService.listarXmlRemotos();
			const archivosNuevos = archivosActuales.filter(f => !this.archivosConocidos.has(f));

			if (archivosNuevos.length === 0) {
				return;
			}

			this.logger.log(`🔔 ${archivosNuevos.length} archivo(s) nuevo(s) detectado(s)`);
			this.stats.totalDetectados += archivosNuevos.length;

			this.procesando = true;
			await this.procesarArchivos(archivosNuevos);

		} catch (e: any) {
			// Error de red/VPN — loguear y continuar sin romper nada
			if (e.message?.includes('SFTP sin conexión') || e.message?.includes('connect') || e.message?.includes('ECONNREFUSED') || e.message?.includes('ETIMEDOUT')) {
				this.logger.warn(`⚠ Error de red (VPN?): ${e.message}`);
			} else {
				this.logger.error(`Error en watcher: ${e.message}`);
			}
		} finally {
			this.procesando = false;
		}
	}

	// ── Procesar archivos nuevos ──────────────────────────────────────────────
	private async procesarArchivos(archivos: string[]): Promise<void> {
		for (const archivo of archivos) {
			try {
				this.logger.log(`⚙ Procesando: ${archivo}`);
				const resultado = await this.sftpProcesadorService.procesarArchivo(archivo);

				if (resultado.estado === 'AUTORIZADO') {
					// Marcar como conocido — ya fue movido a /procesados en el sftp
					this.archivosConocidos.add(archivo);
					this.stats.totalAutorizados++;
					this.stats.ultimoProcesado = archivo;
					this.logger.log(`✓ Autorizado y movido: ${archivo} → ${resultado.numeroAutorizacion}`);

				} else if (resultado.estado === 'DEVUELTA') {
					// NO marcar — reintentará en el próximo ciclo
					this.stats.totalErrores++;
					// Mostrar razones si vienen del resultado
					const razones = (resultado.errores || []).map((r: any) => r?.mensaje || JSON.stringify(r)).join(' ; ');
					this.logger.warn(`↺ DEVUELTA, reintentará: ${archivo}${razones ? ' — razones: ' + razones : ''}`);

				} else {
					this.stats.totalErrores++;
					this.logger.warn(`✗ ${resultado.estado}: ${archivo}`);
				}

			} catch (e: any) {
				this.stats.totalErrores++;
				this.logger.error(`Error en ${archivo}: ${e.message}`);
				// No marcar → reintentará
			}
		}
	}

	// ── Estado del watcher ────────────────────────────────────────────────────
	getEstado(): object {
		return {
			activo: true,
			procesando: this.procesando,
			intervaloSegundos: this.INTERVALO_MS / 1000,
			ultimaRevision: this.stats.ultimaRevision,
			ultimoProcesado: this.stats.ultimoProcesado,
			estadisticas: {
				totalDetectados: this.stats.totalDetectados,
				totalAutorizados: this.stats.totalAutorizados,
				totalErrores: this.stats.totalErrores,
			},
			archivosEnMemoria: [...this.archivosConocidos],
		};
	}

	// ── Forzar revisión inmediata ─────────────────────────────────────────────
	async forzarRevision(): Promise<void> {
		this.logger.log('Revisión forzada manualmente');
		await this.verificarNuevosArchivos();
	}

	// ── Limpiar conocidos (forzar reprocesamiento) ────────────────────────────
	limpiarConocidos(): void {
		const total = this.archivosConocidos.size;
		this.archivosConocidos.clear();
		this.logger.log(`Lista limpiada — ${total} archivos eliminados de memoria`);
	}
}