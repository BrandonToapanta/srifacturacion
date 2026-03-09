import { Injectable, OnModuleInit, Logger } from '@nestjs/common';
import Database from 'better-sqlite3';

@Injectable()
export class DatabaseService implements OnModuleInit {

	private readonly logger = new Logger(DatabaseService.name);

	private _db: Database.Database | null = null;
	private readonly DB_PATH = process.env.DB_PATH || './sri_comprobantes.db';

	onModuleInit() {
		this.getDb(); // forzar inicialización al arrancar
		this.logger.log(`Base de datos SQLite iniciada: ${this.DB_PATH}`);
	}

	private getDb(): Database.Database {
		if (!this._db) {
			this._db = new Database(this.DB_PATH);
			this._db.pragma('journal_mode = WAL');
			this.crearTablas();
		}
		return this._db;
	}

	private crearTablas() {
		this.getDb().exec(`
      CREATE TABLE IF NOT EXISTS comprobantes (
        id                  INTEGER PRIMARY KEY AUTOINCREMENT,
        ruc                 TEXT    NOT NULL,
        ambiente            TEXT    NOT NULL,
        estab               TEXT    NOT NULL,
        pto_emi             TEXT    NOT NULL,
        secuencial          TEXT    NOT NULL,
        cod_doc             TEXT    NOT NULL,
        clave_acceso        TEXT    NOT NULL UNIQUE,
        numero_autorizacion TEXT,
        fecha_autorizacion  TEXT,
        estado              TEXT    NOT NULL DEFAULT 'PENDIENTE',
        fecha_creacion      TEXT    NOT NULL DEFAULT (datetime('now','localtime')),

        UNIQUE(ruc, ambiente, estab, pto_emi, secuencial, cod_doc)
      );

      CREATE INDEX IF NOT EXISTS idx_busqueda
        ON comprobantes(ruc, ambiente, estab, pto_emi, secuencial, cod_doc);
    `);
	}

	insertar(data: {
		ruc: string;
		ambiente: string;
		estab: string;
		pto_emi: string;
		secuencial: string;
		cod_doc: string;
		clave_acceso: string;
	}): void {
		// Convertir undefined a null para SQLite
		const safeData = {
			ruc: data.ruc ?? null,
			ambiente: data.ambiente ?? null,
			estab: data.estab ?? null,
			pto_emi: data.pto_emi ?? null,
			secuencial: data.secuencial ?? null,
			cod_doc: data.cod_doc ?? null,
			clave_acceso: data.clave_acceso ?? null,
		};

		this.logger.log(`Insertando en SQLite: ${safeData.estab}-${safeData.pto_emi}-${safeData.secuencial}`);

		const stmt = this.getDb().prepare(`
        INSERT OR IGNORE INTO comprobantes
            (ruc, ambiente, estab, pto_emi, secuencial, cod_doc, clave_acceso)
        VALUES
            (@ruc, @ambiente, @estab, @pto_emi, @secuencial, @cod_doc, @clave_acceso)
    `);
		stmt.run(safeData);
	}

	actualizarAutorizacion(data: {
		clave_acceso: string;
		numero_autorizacion: string;
		fecha_autorizacion: any;
		estado: string;
	}): void {
		const safeData = {
			clave_acceso: String(data.clave_acceso ?? ''),
			numero_autorizacion: String(data.numero_autorizacion ?? ''),
			fecha_autorizacion: String(data.fecha_autorizacion ?? ''), // convierte Date a string
			estado: String(data.estado ?? ''),
		};

		this.logger.log(`Actualizando autorizacion en SQLite: ${safeData.estado} - ${safeData.clave_acceso}`);

		const stmt = this.getDb().prepare(`
        UPDATE comprobantes SET
            numero_autorizacion = @numero_autorizacion,
            fecha_autorizacion  = @fecha_autorizacion,
            estado              = @estado
        WHERE clave_acceso = @clave_acceso
    `);
		stmt.run(safeData);
	}

	buscarAutorizado(data: {
		ruc: string;
		ambiente: string;
		estab: string;
		pto_emi: string;
		secuencial: string;
		cod_doc: string;
	}): {
		clave_acceso: string;
		numero_autorizacion: string;
		fecha_autorizacion: string;
		estado: string;
	} | null {
		const stmt = this.getDb().prepare(`
      SELECT clave_acceso, numero_autorizacion, fecha_autorizacion, estado
      FROM comprobantes
      WHERE ruc        = @ruc
        AND ambiente   = @ambiente
        AND estab      = @estab
        AND pto_emi    = @pto_emi
        AND secuencial = @secuencial
        AND cod_doc    = @cod_doc
        AND estado     = 'AUTORIZADO'
      LIMIT 1
    `);
		return stmt.get(data) as any || null;
	}

	buscarCualquierEstado(data: {
		ruc: string;
		ambiente: string;
		estab: string;
		pto_emi: string;
		secuencial: string;
		cod_doc: string;
	}): {
		clave_acceso: string;
		numero_autorizacion: string;
		fecha_autorizacion: string;
		estado: string;
	} | null {
		const stmt = this.getDb().prepare(`
        SELECT clave_acceso, numero_autorizacion, fecha_autorizacion, estado
        FROM comprobantes
        WHERE ruc        = @ruc
          AND ambiente   = @ambiente
          AND estab      = @estab
          AND pto_emi    = @pto_emi
          AND secuencial = @secuencial
          AND cod_doc    = @cod_doc
        ORDER BY fecha_creacion DESC
        LIMIT 1
    `);
		return stmt.get(data) as any || null;
	}

	listarTodos(limite = 50): any[] {
		return this.getDb().prepare(`
      SELECT * FROM comprobantes ORDER BY fecha_creacion DESC LIMIT ?
    `).all(limite) as any[];
	}
}