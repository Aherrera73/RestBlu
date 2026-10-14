# Genera los diagramas de RestBlu:
#   - RestBlu-proceso-reserva.bpmn  (BPMN 2.0, se importa en Bizagi Modeler)
#   - RestBlu-diagramas.drawio      (draw.io: arquitectura + flujo de reserva)
import os
import xml.dom.minidom
from xml.sax.saxutils import escape, quoteattr

OUT = r'D:\RB\documentacion\diagramas'
os.makedirs(OUT, exist_ok=True)

# ---------------------------------------------------------------- proceso
LANES = [
    ('L_huesped', 'Huésped (app / web)'),
    ('L_firebase', 'Firebase (nube)'),
    ('L_gestor', 'Gestor RestBlu (PC)'),
    ('L_webpay', 'Webpay Transbank'),
    ('L_hub', 'Hub Dahua (PC)'),
    ('L_dahua', 'Terminal Dahua (vivienda)'),
]
LANE_H = 200
COL_W = 170
POOL_X, POOL_Y = 40, 40
POOL_LABEL, LANE_LABEL = 30, 40
FIRST_X = POOL_X + POOL_LABEL + LANE_LABEL + 30
SIZES = {'start': (36, 36), 'end': (36, 36), 'timer': (36, 36), 'gateway': (50, 50),
         'user': (130, 70), 'service': (130, 70)}

# (id, tipo, carril, columna, nombre, desplazamiento vertical en el carril)
NODES = [
    ('S1', 'start', 'L_huesped', 0, 'Quiere reservar', 0),
    ('T1', 'user', 'L_huesped', 1, 'Iniciar sesión (correo o Google)', 0),
    ('G1', 'gateway', 'L_huesped', 2, '¿Cuenta con RUT y correo verificado?', 0),
    ('T2', 'user', 'L_huesped', 3, 'Completar registro: RUT único y código de 6 dígitos', 55),
    ('G2', 'gateway', 'L_huesped', 4, '', 0),
    ('T3', 'user', 'L_huesped', 5, 'Elegir alojamiento, fechas y huéspedes', 0),
    ('T4', 'service', 'L_firebase', 6, 'Guardar solicitud (reservation_intake)', 0),
    ('T5', 'service', 'L_gestor', 7, 'Validar datos y recalcular el precio', 0),
    ('G3', 'gateway', 'L_gestor', 8, '¿Fechas disponibles?', 0),
    ('T7', 'service', 'L_gestor', 9, 'Crear reserva pendiente de pago (60 min)', -50),
    ('T6', 'service', 'L_gestor', 9, 'Rechazar: fechas ocupadas', 50),
    ('E1', 'end', 'L_gestor', 10, 'Reserva rechazada', 50),
    ('T8', 'user', 'L_huesped', 10, 'Pagar con Webpay', 0),
    ('T9', 'service', 'L_webpay', 11, 'Autorizar el pago con tarjeta', 0),
    ('T10', 'service', 'L_gestor', 12, 'Verificar el pago en Transbank', 0),
    ('G4', 'gateway', 'L_gestor', 13, '¿Pago aprobado?', 0),
    ('T12', 'service', 'L_gestor', 14, 'Confirmar reserva y generar código QR', -50),
    ('T11', 'service', 'L_gestor', 14, 'Liberar fechas: reserva expirada', 50),
    ('E2', 'end', 'L_gestor', 15, 'Reserva expirada', 50),
    ('T13', 'service', 'L_hub', 15, 'Enviar persona, QR y vigencia al terminal', 0),
    ('T14', 'service', 'L_dahua', 16, 'Registrar huésped (válido del check-in al check-out)', 0),
    ('T15', 'service', 'L_gestor', 17, 'Enviar correo de confirmación con PDF', 0),
    ('T16', 'service', 'L_firebase', 18, 'Publicar estado y QR dinámico', 0),
    ('T17', 'user', 'L_huesped', 19, 'Ver el QR en la app o la web', 0),
    ('T18', 'user', 'L_huesped', 20, 'Presentar el QR en el lector', 0),
    ('G5', 'gateway', 'L_dahua', 21, '¿QR válido y vigente?', 0),
    ('T19', 'service', 'L_dahua', 22, 'Abrir la puerta', -50),
    ('T20', 'service', 'L_dahua', 22, 'Rechazar el acceso', 50),
    ('T21', 'service', 'L_dahua', 23, 'Registrar movimiento (entrada / salida)', -50),
    ('T24', 'service', 'L_dahua', 23, 'Registrar el intento rechazado', 50),
    ('E4', 'end', 'L_dahua', 24, 'Acceso denegado (puede reintentar)', 50),
    ('T22', 'service', 'L_gestor', 24, 'Copiar el movimiento a Seguridad', 0),
    ('IE1', 'timer', 'L_gestor', 25, 'Llega el check-out', 0),
    ('T23', 'service', 'L_hub', 26, 'Eliminar la persona del terminal', 0),
    ('E3', 'end', 'L_hub', 27, 'Estadía finalizada', 0),
]
FLOWS = [
    ('S1', 'T1', ''), ('T1', 'G1', ''), ('G1', 'T2', 'No'), ('G1', 'G2', 'Sí'), ('T2', 'G2', ''),
    ('G2', 'T3', ''), ('T3', 'T4', ''), ('T4', 'T5', ''), ('T5', 'G3', ''),
    ('G3', 'T7', 'Sí'), ('G3', 'T6', 'No'), ('T6', 'E1', ''),
    ('T7', 'T8', ''), ('T8', 'T9', ''), ('T9', 'T10', ''), ('T10', 'G4', ''),
    ('G4', 'T12', 'Sí'), ('G4', 'T11', 'No'), ('T11', 'E2', ''),
    ('T12', 'T13', ''), ('T13', 'T14', ''), ('T14', 'T15', ''), ('T15', 'T16', ''),
    ('T16', 'T17', ''), ('T17', 'T18', ''), ('T18', 'G5', ''),
    ('G5', 'T19', 'Sí'), ('G5', 'T20', 'No'),
    ('T19', 'T21', ''), ('T20', 'T24', ''), ('T24', 'E4', ''), ('T21', 'T22', ''), ('T22', 'IE1', ''), ('IE1', 'T23', ''), ('T23', 'E3', ''),
]

lane_index = {lane: i for i, (lane, _) in enumerate(LANES)}
cols = max(node[3] for node in NODES) + 1
POOL_W = POOL_LABEL + LANE_LABEL + 30 + cols * COL_W + 20
POOL_H = LANE_H * len(LANES)

geo = {}
for nid, kind, lane, col, name, dy in NODES:
    w, h = SIZES[kind]
    cx = FIRST_X + col * COL_W + 65
    cy = POOL_Y + lane_index[lane] * LANE_H + LANE_H / 2 + dy
    geo[nid] = (cx - w / 2, cy - h / 2, w, h)
kinds = {n[0]: n[1] for n in NODES}


def waypoints(src, dst):
    sx, sy, sw, sh = geo[src]
    tx, ty, tw, th = geo[dst]
    scy, tcy = sy + sh / 2, ty + th / 2
    if abs(scy - tcy) < 1:
        return [(sx + sw, scy), (tx, tcy)]
    if kinds[src] == 'gateway':
        # Las ramas salen por arriba o por abajo del rombo.
        scx = sx + sw / 2
        start = (scx, sy) if tcy < scy else (scx, sy + sh)
        return [start, (scx, tcy), (tx, tcy)]
    mid = tx - 22
    return [(sx + sw, scy), (mid, scy), (mid, tcy), (tx, tcy)]


# ---------------------------------------------------------------- BPMN
def bpmn():
    out = ['<?xml version="1.0" encoding="UTF-8"?>',
           '<bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL" '
           'xmlns:bpmndi="http://www.omg.org/spec/BPMN/20100524/DI" '
           'xmlns:dc="http://www.omg.org/spec/DD/20100524/DC" '
           'xmlns:di="http://www.omg.org/spec/DD/20100524/DI" '
           'xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" '
           'id="RestBlu_Definiciones" targetNamespace="http://restblu.cl/bpmn" '
           'exporter="RestBlu" exporterVersion="1.0">',
           '  <bpmn:collaboration id="Colaboracion_RestBlu">',
           '    <bpmn:participant id="Pool_RestBlu" name="RestBlu: reserva y acceso" processRef="Proceso_Reserva" />',
           '  </bpmn:collaboration>',
           '  <bpmn:process id="Proceso_Reserva" name="Reserva y acceso RestBlu" isExecutable="false">',
           '    <bpmn:laneSet id="Carriles">']
    for lane, name in LANES:
        out.append(f'      <bpmn:lane id="{lane}" name={quoteattr(name)}>')
        out += [f'        <bpmn:flowNodeRef>{n[0]}</bpmn:flowNodeRef>' for n in NODES if n[2] == lane]
        out.append('      </bpmn:lane>')
    out.append('    </bpmn:laneSet>')
    tags = {'start': 'startEvent', 'end': 'endEvent', 'timer': 'intermediateCatchEvent',
            'gateway': 'exclusiveGateway', 'user': 'userTask', 'service': 'serviceTask'}
    for i, (src, dst, label) in enumerate(FLOWS):
        pass
    for nid, kind, lane, col, name, dy in NODES:
        tag = tags[kind]
        extra = ''
        if kind == 'gateway':
            outgoing = sum(1 for f in FLOWS if f[0] == nid)
            extra = f' gatewayDirection="{"Diverging" if outgoing > 1 else "Converging"}"'
        out.append(f'    <bpmn:{tag} id="{nid}" name={quoteattr(name)}{extra}>')
        for i, f in enumerate(FLOWS):
            if f[1] == nid:
                out.append(f'      <bpmn:incoming>F{i + 1}</bpmn:incoming>')
        for i, f in enumerate(FLOWS):
            if f[0] == nid:
                out.append(f'      <bpmn:outgoing>F{i + 1}</bpmn:outgoing>')
        if kind == 'timer':
            out.append(f'      <bpmn:timerEventDefinition id="{nid}_def" />')
        out.append(f'    </bpmn:{tag}>')
    for i, (src, dst, label) in enumerate(FLOWS):
        out.append(f'    <bpmn:sequenceFlow id="F{i + 1}" name={quoteattr(label)} sourceRef="{src}" targetRef="{dst}" />')
    out.append('  </bpmn:process>')
    out.append('  <bpmndi:BPMNDiagram id="Diagrama_RestBlu" name="Reserva y acceso">')
    out.append('    <bpmndi:BPMNPlane id="Plano_RestBlu" bpmnElement="Colaboracion_RestBlu">')
    out.append(f'      <bpmndi:BPMNShape id="Pool_RestBlu_di" bpmnElement="Pool_RestBlu" isHorizontal="true">'
               f'<dc:Bounds x="{POOL_X}" y="{POOL_Y}" width="{POOL_W}" height="{POOL_H}" /></bpmndi:BPMNShape>')
    for i, (lane, _) in enumerate(LANES):
        out.append(f'      <bpmndi:BPMNShape id="{lane}_di" bpmnElement="{lane}" isHorizontal="true">'
                   f'<dc:Bounds x="{POOL_X + POOL_LABEL}" y="{POOL_Y + i * LANE_H}" width="{POOL_W - POOL_LABEL}" height="{LANE_H}" /></bpmndi:BPMNShape>')
    for nid, kind, *_ in NODES:
        x, y, w, h = geo[nid]
        marker = ' isMarkerVisible="true"' if kind == 'gateway' else ''
        out.append(f'      <bpmndi:BPMNShape id="{nid}_di" bpmnElement="{nid}"{marker}>'
                   f'<dc:Bounds x="{x:.0f}" y="{y:.0f}" width="{w}" height="{h}" /></bpmndi:BPMNShape>')
    for i, (src, dst, label) in enumerate(FLOWS):
        points = ''.join(f'<di:waypoint x="{px:.0f}" y="{py:.0f}" />' for px, py in waypoints(src, dst))
        out.append(f'      <bpmndi:BPMNEdge id="F{i + 1}_di" bpmnElement="F{i + 1}">{points}</bpmndi:BPMNEdge>')
    out += ['    </bpmndi:BPMNPlane>', '  </bpmndi:BPMNDiagram>', '</bpmn:definitions>']
    return '\n'.join(out) + '\n'


# ---------------------------------------------------------------- draw.io
class Page:
    def __init__(self, pid, name):
        self.pid, self.name, self.cells, self.n = pid, name, [], 0

    def nid(self):
        self.n += 1
        return f'{self.pid}-{self.n}'

    def vertex(self, value, x, y, w, h, style, parent='1', cid=None):
        cid = cid or self.nid()
        self.cells.append(f'<mxCell id="{cid}" value={quoteattr(value)} style="{style}" vertex="1" parent="{parent}">'
                          f'<mxGeometry x="{x:.0f}" y="{y:.0f}" width="{w:.0f}" height="{h:.0f}" as="geometry" /></mxCell>')
        return cid

    def edge(self, src, dst, value='', style='', points=None, offset=None):
        cid = self.nid()
        pts = '' if offset is None else f'<mxPoint as="offset" y="{offset}" />'
        if points:
            pts += '<Array as="points">' + ''.join(f'<mxPoint x="{x:.0f}" y="{y:.0f}" />' for x, y in points) + '</Array>'
        self.cells.append(f'<mxCell id="{cid}" value={quoteattr(value)} style="{style}" edge="1" parent="1" source="{src}" target="{dst}">'
                          f'<mxGeometry relative="1" as="geometry">{pts}</mxGeometry></mxCell>')

    def xml(self, w, h):
        body = ''.join(self.cells)
        return (f'<diagram id="{self.pid}" name={quoteattr(self.name)}><mxGraphModel dx="1400" dy="900" grid="1" gridSize="10" '
                f'guides="1" tooltips="1" connect="1" arrows="1" fold="1" page="1" pageScale="1" pageWidth="{w}" pageHeight="{h}" '
                f'math="0" shadow="0"><root><mxCell id="0" /><mxCell id="1" parent="0" />{body}</root></mxGraphModel></diagram>')


def br(text):
    return text.replace('\n', '<br>')


def use_cases():
    # Diagrama UML de casos de uso: actores fuera del límite del sistema,
    # casos de uso (óvalos) dentro, «include» y «extend» punteados.
    p = Page('uc', 'Casos de uso')
    p.vertex('RestBlu · diagrama de casos de uso', 20, 4, 900, 36,
             'text;html=1;fontSize=22;fontStyle=1;align=left;verticalAlign=middle;fontColor=#103D50;')
    p.vertex('<b>Sistema RestBlu</b>', 280, 40, 980, 1260,
             'rounded=0;whiteSpace=wrap;html=1;fillColor=#FAFCFD;strokeColor=#103D50;strokeWidth=2;'
             'verticalAlign=top;align=center;fontSize=15;spacingTop=6;')
    ellipse = 'ellipse;whiteSpace=wrap;html=1;fontSize=12;fillColor={0};strokeColor={1};'
    styles = {
        'huesped': ellipse.format('#DAE8FC', '#6C8EBF'),
        'admin': ellipse.format('#D5E8D4', '#82B366'),
        'shared': ellipse.format('#E1D5E7', '#9673A6'),
        'auto': ellipse.format('#F5F5F5', '#666666'),
    }
    A, B = 500, 880  # columnas de casos de uso
    uc = {}
    for key, text, cx, cy, kind in [
        ('registrarse', 'Registrarse con RUT y correo', A, 100, 'huesped'),
        ('sesion', 'Iniciar sesión (correo o Google)', A, 190, 'huesped'),
        ('buscar', 'Buscar alojamientos', A, 280, 'huesped'),
        ('reservar', 'Reservar alojamiento', A, 370, 'huesped'),
        ('mis', 'Ver mis reservas y comprobante PDF', A, 460, 'huesped'),
        ('qr', 'Ver QR de acceso', A, 550, 'huesped'),
        ('ingresar', 'Ingresar a la vivienda (QR o PIN)', A, 640, 'huesped'),
        ('perfil', 'Gestionar perfil, favoritos y cuenta', A, 730, 'huesped'),
        ('ia', 'Consultar asistente IA', A, 830, 'shared'),
        ('alojamientos', 'Gestionar alojamientos', A, 920, 'admin'),
        ('clientes', 'Gestionar clientes y cuentas', A, 1000, 'admin'),
        ('estadias', 'Revisar estadías y accesos', A, 1080, 'admin'),
        ('seguridad', 'Monitorear entradas y salidas', A, 1160, 'admin'),
        ('terminales', 'Monitorear terminales Dahua', A, 1240, 'admin'),
        ('codigo', 'Verificar correo con código', B, 100, 'huesped'),
        ('pagar', 'Pagar con Webpay', B, 320, 'huesped'),
        ('habilitar', 'Habilitar acceso en el terminal', B, 410, 'auto'),
        ('comprobante', 'Enviar comprobante por correo', B, 510, 'auto'),
        ('rostro', 'Registrar rostro (opcional)', B, 710, 'huesped'),
        ('asignar', 'Asignar terminal Dahua', B, 920, 'admin'),
        ('revocar', 'Revocar acceso al terminar la estadía', B, 1040, 'auto'),
    ]:
        uc[key] = p.vertex(text, cx - 100, cy - 30, 200, 60, styles[kind])

    actor = 'shape=umlActor;html=1;fontSize=12;fontStyle=1;verticalLabelPosition=bottom;verticalAlign=top;'
    system = 'shape=umlActor;html=1;fontSize=11;verticalLabelPosition=bottom;verticalAlign=top;fillColor=#F5F5F5;strokeColor=#666666;'
    ac = {
        'huesped': p.vertex('Huésped', 110, 345, 40, 70, actor),
        'admin': p.vertex('Administrador', 110, 1045, 40, 70, actor),
        'firebase': p.vertex('Firebase Auth<br>«sistema»', 1360, 110, 40, 70, system),
        'correo': p.vertex('Correo SMTP<br>«sistema»', 1360, 250, 40, 70, system),
        'webpay': p.vertex('Webpay Transbank<br>«sistema»', 1360, 400, 40, 70, system),
        'dahua': p.vertex('Terminal Dahua<br>«dispositivo»', 1360, 565, 40, 70, system),
        'tiempo': p.vertex('Tiempo<br>(check-out)', 1360, 1005, 40, 70, system),
    }
    assoc = 'html=1;endArrow=none;strokeColor=#5F7D8C;'

    def line(actor_key, uc_key, left_actor):
        side = 'exitX=1;exitY=0.5;entryX=0;entryY=0.5;' if left_actor else 'exitX=0;exitY=0.5;entryX=1;entryY=0.5;'
        p.edge(ac[actor_key], uc[uc_key], '', assoc + side)

    for key in ['registrarse', 'sesion', 'buscar', 'reservar', 'mis', 'qr', 'ingresar', 'perfil', 'ia']:
        line('huesped', key, True)
    for key in ['ia', 'alojamientos', 'clientes', 'estadias', 'seguridad', 'terminales']:
        line('admin', key, True)
    for actor_key, keys in [('firebase', ['codigo', 'sesion']), ('correo', ['codigo', 'comprobante']),
                            ('webpay', ['pagar']), ('dahua', ['habilitar', 'ingresar', 'rostro', 'revocar']),
                            ('tiempo', ['revocar'])]:
        for key in keys:
            line(actor_key, key, False)

    dep = 'html=1;dashed=1;endArrow=open;endSize=10;fontSize=10;fontStyle=2;labelBackgroundColor=default;'
    for base, target in [('registrarse', 'codigo'), ('reservar', 'pagar'), ('reservar', 'habilitar'), ('reservar', 'comprobante')]:
        p.edge(uc[base], uc[target], '«include»', dep + 'exitX=1;exitY=0.5;entryX=0;entryY=0.5;')
    for extension, base in [('rostro', 'ingresar'), ('asignar', 'alojamientos')]:
        p.edge(uc[extension], uc[base], '«extend»', dep + 'exitX=0;exitY=0.5;entryX=1;entryY=0.5;')

    legend = ('<b>Leyenda</b><br>'
              '<font color="#6C8EBF">■</font> Huésped &nbsp; <font color="#82B366">■</font> Administrador &nbsp; '
              '<font color="#9673A6">■</font> Ambos &nbsp; <font color="#666666">■</font> Automático (lo hace el sistema)<br>'
              '«include»: siempre ocurre como parte del caso base. «extend»: opcional.<br>'
              'Para reservar, ver reservas o el QR, el huésped debe haber iniciado sesión.')
    p.vertex(legend, 20, 1320, 1240, 80,
             'rounded=1;whiteSpace=wrap;html=1;align=left;verticalAlign=top;spacing=10;fontSize=12;fillColor=#F5F5F5;strokeColor=#BBBBBB;')
    return p.xml(1480, 1420)


def architecture():
    # Zonas en filas (de arriba hacia abajo) para que casi todas las flechas
    # sean verticales y cortas. Cada flecha lleva su ruta fija para no cruzarse.
    p = Page('arq', 'Arquitectura')
    p.vertex('RestBlu · arquitectura del sistema', 20, 8, 900, 40,
             'text;html=1;fontSize=22;fontStyle=1;align=left;verticalAlign=middle;fontColor=#103D50;')
    zone = ('swimlane;horizontal=0;startSize=34;html=1;fontStyle=1;fontSize=13;rounded=0;'
            'fillColor={fill};strokeColor={stroke};swimlaneFillColor={inner};')
    for name, y, h, fill, stroke, inner in [
        ('Usuarios', 70, 120, '#E6E6E6', '#999999', '#FAFAFA'),
        ('Clientes', 200, 120, '#DAE8FC', '#6C8EBF', '#F4F8FE'),
        ('Nube (Internet)', 330, 170, '#FFF2CC', '#D6B656', '#FFFCF2'),
        ('PC RestBlu (servidor local)', 510, 350, '#D5E8D4', '#82B366', '#F6FBF5'),
        ('Vivienda', 870, 140, '#F8CECC', '#B85450', '#FFF7F6'),
    ]:
        p.vertex(name, 20, y, 1620, h, zone.format(fill=fill, stroke=stroke, inner=inner))

    def box(text, cx, cy, w, h, fill, stroke):
        return p.vertex(br(text), cx - w / 2, cy - h / 2, w, h,
                        f'rounded=1;whiteSpace=wrap;html=1;arcSize=12;fontSize=12;fillColor={fill};strokeColor={stroke};')
    blue, yellow, green, red = ('#DAE8FC', '#6C8EBF'), ('#FFF2CC', '#D6B656'), ('#D5E8D4', '#82B366'), ('#F8CECC', '#B85450')
    c = {}
    c['firebase'] = p.vertex('<b>Firebase</b>', 70, 345, 500, 140,
                             'rounded=1;arcSize=6;html=1;dashed=1;fillColor=none;strokeColor=#D6B656;verticalAlign=top;align=left;spacingLeft=10;fontSize=12;')
    c['huesped'] = p.vertex('Huésped', 300, 95, 40, 60,
                            'shape=umlActor;html=1;fontSize=12;fontStyle=1;verticalLabelPosition=bottom;verticalAlign=top;')
    c['admin'] = p.vertex('Administrador', 1140, 95, 40, 60,
                          'shape=umlActor;html=1;fontSize=12;fontStyle=1;labelPosition=left;verticalLabelPosition=middle;align=right;verticalAlign=middle;')
    c['app'] = box('<b>App Android</b>\nKotlin · Jetpack Compose', 200, 260, 200, 70, *blue)
    c['web'] = box('<b>Sitio web</b>\nrestblu.web.app · React', 440, 260, 200, 70, *blue)
    c['panel'] = box('<b>Panel de control</b>\nnavegador · 127.0.0.1:3100', 1160, 260, 220, 70, *blue)
    c['auth'] = box('<b>Authentication</b>\ncorreo o Google', 200, 425, 200, 64, *yellow)
    c['firestore'] = box('<b>Cloud Firestore</b> (puente)\nsolicitudes, estado, perfiles,\nRUT único, QR dinámico', 440, 425, 220, 76, *yellow)
    c['webpay'] = box('<b>Transbank Webpay Plus</b>\npago con tarjeta', 680, 425, 180, 64, *yellow)
    c['worker'] = box('<b>Cloudflare Worker</b>\nrestblu-pagos', 920, 425, 180, 64, *yellow)
    c['ngrok'] = box('<b>Túnel ngrok TCP</b>\n0.tcp.sa.ngrok.io:puerto', 1400, 425, 200, 64, *yellow)
    c['smtp'] = box('<b>Correo SMTP</b>\nGmail', 190, 600, 220, 64, *green)
    c['gestor'] = box('<b>Gestor RestBlu</b> · Node :3100\nreservas, precios, PDF, QR,\nIA, seguridad, cuentas', 480, 600, 240, 90, *green)
    c['hub'] = box('<b>Hub Dahua</b> · Node\nTCP :9500 (HTTP / HTTPS)\nAPI :3200 · cola de comandos', 1400, 600, 200, 90, *green)
    c['ia'] = box('<b>Asistente IA</b>\nservidor Ollama', 190, 790, 220, 64, *green)
    c['sql'] = p.vertex(br('<b>SQL Server</b> · base RestBlu\ndbo: alojamientos, clientes,\nestadías, accesos\nhub: terminales, logs, comandos'), 820, 740, 200, 100,
                        'shape=cylinder3;whiteSpace=wrap;html=1;boundedLbl=1;size=10;fontSize=11;fillColor=#D5E8D4;strokeColor=#82B366;')
    c['puerta'] = box('<b>Puerta</b>\ncerradura eléctrica', 1150, 940, 180, 64, *red)
    c['dahua'] = box('<b>Terminal Dahua</b>\nDHI-ASI6214S-PW\nQR · PIN · rostro', 1400, 940, 200, 76, *red)

    e = 'html=1;rounded=1;endArrow=block;endFill=1;fontSize=10;labelBackgroundColor=default;'
    both = e + 'startArrow=block;startFill=1;'

    def link(a, b, label, ex, ey, nx, ny, points=(), style=e, offset=None):
        p.edge(c[a], c[b], label, style + f'exitX={ex};exitY={ey};entryX={nx};entryY={ny};', list(points), offset)

    link('huesped', 'app', 'usa', 0, 0.5, 0.5, 0, [(200, 125)])
    link('huesped', 'web', 'usa', 1, 0.5, 0.5, 0, [(440, 125)])
    link('admin', 'panel', 'abre', 0.5, 1, 0.5, 0)
    link('app', 'firebase', 'sesión y reservas', 0.5, 1, 0.26, 0, style=both)
    link('web', 'firebase', 'sesión y reservas', 0.5, 1, 0.74, 0, style=both)
    link('web', 'worker', 'pagar (app y web)', 1, 0.5, 0.4, 0, [(902, 260)])
    link('worker', 'webpay', 'transacción', 0, 0.5, 1, 0.5, offset=-12)
    link('gestor', 'firebase', 'lee solicitudes, publica estado y QR', 0.25, 0, 0.7, 1, style=both)
    link('gestor', 'webpay', 'verifica el pago', 0.9, 0, 0.5, 1, [(576, 515), (680, 515)])
    link('panel', 'gestor', 'lo sirve el gestor', 0.5, 1, 1, 0.5, [(1160, 600)])
    link('gestor', 'smtp', 'correos y PDF', 0, 0.5, 1, 0.5, offset=-12)
    link('gestor', 'ia', 'asistente', 0.1, 1, 1, 0.5, [(384, 790)])
    link('gestor', 'sql', 'tablas dbo', 0.5, 1, 0, 0.5, [(480, 790)], style=both)
    link('gestor', 'hub', 'CGI por API :3200 (con clave)', 0.9, 1, 0.3, 1, [(576, 700), (1360, 700)])
    link('hub', 'sql', 'esquema hub', 0.7, 1, 1, 0.5, [(1440, 790)], style=both)
    link('ngrok', 'hub', 'TCP → localhost:9500', 0.5, 1, 0.5, 0)
    link('dahua', 'ngrok', 'Registro Automático CGI<br>(conexión saliente, HTTPS)', 1, 0.5, 1, 0.5, [(1570, 940), (1570, 425)])
    link('dahua', 'puerta', 'abre', 0, 0.5, 1, 0.5, offset=-12)
    link('huesped', 'dahua', 'presenta QR / PIN / rostro en el lector', 0.5, 0, 1, 0.75, [(320, 58), (1610, 58), (1610, 959)],
         style=e + 'dashed=1;strokeColor=#B85450;fontColor=#B85450;')

    notes = ('<b>Cómo funciona por detrás</b><br>'
             '1. La app y la web nunca hablan con el PC: dejan las solicitudes en Firestore.<br>'
             '2. El gestor, en el PC, las procesa cada pocos segundos y publica el resultado (estado, QR dinámico) en Firestore.<br>'
             '3. El Dahua abre él mismo la conexión hacia el hub (por ngrok), así funciona desde cualquier red.<br>'
             '4. El hub envía por esa conexión los comandos del gestor: crear huésped con QR y vigencia, revocar, leer accesos.<br>'
             '5. Con el PC apagado, el Dahua sigue validando los accesos ya cargados.')
    p.vertex(notes, 20, 1030, 1620, 120,
             'rounded=1;whiteSpace=wrap;html=1;align=left;verticalAlign=top;spacing=12;fontSize=12;fillColor=#F5F5F5;strokeColor=#BBBBBB;')
    return p.xml(1680, 1180)


def process_page():
    p = Page('flujo', 'Flujo de reserva')
    p.vertex('<b>RestBlu: reserva y acceso</b>', POOL_X, POOL_Y, POOL_W, POOL_H,
             'swimlane;horizontal=0;startSize=30;html=1;fontSize=14;fillColor=#103D50;fontColor=#FFFFFF;strokeColor=#103D50;swimlaneFillColor=#FFFFFF;',
             cid='pool')
    colors = ['#EAF2FB', '#FFF8E1', '#EAF6EA', '#FFF8E1', '#EAF6EA', '#FDECEA']
    for i, (lane, name) in enumerate(LANES):
        p.vertex(name, POOL_X + POOL_LABEL, POOL_Y + i * LANE_H, POOL_W - POOL_LABEL, LANE_H,
                 f'swimlane;horizontal=0;startSize={LANE_LABEL};html=1;fontSize=12;fontStyle=1;swimlaneFillColor={colors[i]};fillColor={colors[i]};strokeColor=#9AA7AE;',
                 cid=lane)
    styles = {
        'start': 'ellipse;html=1;fillColor=#D5E8D4;strokeColor=#2E7D32;strokeWidth=2;verticalLabelPosition=bottom;verticalAlign=top;fontSize=11;',
        'end': 'ellipse;html=1;fillColor=#F8CECC;strokeColor=#B71C1C;strokeWidth=4;verticalLabelPosition=bottom;verticalAlign=top;fontSize=11;',
        'timer': 'shape=mxgraph.bpmn.event;outline=catching;symbol=timer;html=1;verticalLabelPosition=bottom;verticalAlign=top;fontSize=11;',
        'gateway': 'shape=mxgraph.bpmn.gateway2;gwType=exclusive;html=1;fillColor=#FFF2CC;strokeColor=#B08800;verticalLabelPosition=top;verticalAlign=bottom;labelPosition=right;align=left;fontSize=11;whiteSpace=wrap;',
        'user': 'rounded=1;whiteSpace=wrap;html=1;arcSize=14;fontSize=11;fillColor=#DAE8FC;strokeColor=#6C8EBF;',
        'service': 'rounded=1;whiteSpace=wrap;html=1;arcSize=14;fontSize=11;fillColor=#FFFFFF;strokeColor=#5F7D8C;',
    }
    for nid, kind, lane, col, name, dy in NODES:
        x, y, w, h = geo[nid]
        p.vertex(name, x, y, w, h, styles[kind], cid=nid)
    e = 'edgeStyle=orthogonalEdgeStyle;rounded=1;html=1;endArrow=block;endFill=1;fontSize=11;fontStyle=1;'
    for src, dst, label in FLOWS:
        pts = waypoints(src, dst)[1:-1]
        p.edge(src, dst, label, e, pts)
    return p.xml(int(POOL_X * 2 + POOL_W), int(POOL_Y * 2 + POOL_H))


with open(os.path.join(OUT, 'RestBlu-proceso-reserva.bpmn'), 'w', encoding='utf-8', newline='\n') as f:
    f.write(bpmn())
with open(os.path.join(OUT, 'RestBlu-diagramas.drawio'), 'w', encoding='utf-8', newline='\n') as f:
    f.write('<mxfile host="RestBlu" version="24.0.0">' + use_cases() + process_page() + architecture() + '</mxfile>\n')

for name in ('RestBlu-proceso-reserva.bpmn', 'RestBlu-diagramas.drawio'):
    xml.dom.minidom.parse(os.path.join(OUT, name))
    print('ok', name, os.path.getsize(os.path.join(OUT, name)), 'bytes')
