# Lista de solicitudes de transparencia para la Fase 1c

Esta lista reúne lo que ya se acordó pedir y lo que se fue sumando. **La 1c redacta cada solicitud en su propio archivo en esta carpeta; el dueño las presenta.** Sin código de ingesta hasta que llegue cada archivo.

| # | Destinatario | Qué se pide | Origen |
|---|---|---|---|
| R1 | Fonasa | Atenciones MLE por prestador y comuna de residencia, y beneficiarios por comuna de residencia | `BRIEF.md` §Fase 1c |
| R2 | Superintendencia de Salud | Prestaciones Isapre por prestador y comuna | `BRIEF.md` §Fase 1c |
| R4 | DEIS / MINSAL | Egresos hospitalarios **con código de establecimiento** (y comuna del establecimiento); sin ella no hay flujos comuna→establecimiento | `HALLAZGOS_FASE0.md` §11, decisión D4 |
| **R5** | **SEREMI de Salud de Coquimbo y DEIS** | **El criterio con que se registran los establecimientos privados (consultas, clínicas dentales, centros de especialidades, tomas de muestras) y si difiere entre regiones** | Revisión del PR #18; `HALLAZGOS_FASE1A.md` §7 |

(R3 no existe: la numeración conserva la de `HALLAZGOS_FASE0.md`.)

## R5 — contenido mínimo de la consulta
Contexto que se debe citar (del archivo `establecimientos_20261014.csv`, SHA-256 `244426f9201ecfaa4f8dc964d3ee7479a65eef565c37b9ddf05d22cac31343a6`): la región de Coquimbo trae 417 establecimientos privados vigentes; 119 son clínicas dentales (Biobío 9, Metropolitana 62) y 63 centros de especialidades (Biobío 0, Metropolitana 1). En La Serena, 212 de 239 establecimientos vigentes los registra la SEREMI de Salud de Coquimbo.

Preguntas:
1. ¿Qué criterio usa cada SEREMI para dar de alta como **establecimiento distinto** una consulta, un box o una clínica dental que funciona dentro de un centro médico o en la misma dirección?
2. ¿Qué criterio decide el **tipo** con que se registra (Centro de Salud Privado, Clínica Dental, Centro de Especialidades, Sala Externa de Toma de Muestras)? ¿Es el mismo en todas las regiones?
3. ¿Hay instructivo nacional, o cada SEREMI aplica el suyo? ¿Cambió el criterio en el tiempo (altas masivas, regularizaciones)?
4. ¿Cuándo se da de baja un establecimiento privado (hoy hay 428 cerrados, 73 sin fecha de cierre)?
5. Si difiere entre regiones, ¿existe una variable en el registro que permita distinguir **establecimiento** de **consulta o unidad** dentro de uno mayor?

## Estado
* **R5: pendiente de redactar (1c) y de presentar (dueño).**
* Mientras no haya respuesta, **la causa de la heterogeneidad queda [NO COMPROBADO] en la ficha** de la capa y en DISENO §2.12. Cuando llegue, se registra la respuesta (fecha, quién respondió) en `HALLAZGOS_FASE1A.md` §7.3 y se ajusta la ficha.
