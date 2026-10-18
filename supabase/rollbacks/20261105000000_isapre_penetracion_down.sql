-- ROLLBACK de 20261105000000_isapre_penetracion.sql. La migración solo agregó dos funciones (ninguna tabla ni fila): no se pierde ningún dato.
-- Las capturas Isapre y Censo, sus tablas y RPC quedan intactas. Revertir ANTES el front que llama a get_isapre_penetracion (si no, la métrica «Penetración» mostrará «sin dato»).
drop function if exists public.get_isapre_penetracion(text, integer);
drop function if exists public._penetracion_denominador(integer, text, integer);
