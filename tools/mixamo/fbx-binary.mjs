/**
 * Leitura e escrita mínimas do formato FBX binário (7.x), só o necessário para
 * podar nós de um arquivo exportado pela Mixamo. As propriedades de cada nó são
 * mantidas como bytes crus (inclusive arrays comprimidos), então o que fica no
 * arquivo é bit a bit o que a Mixamo gerou.
 */
const MAGIC = Buffer.from('Kaydara FBX Binary  \x00\x1a\x00', 'binary');

export function readFBX(buf) {
  if (!buf.subarray(0, 23).equals(MAGIC)) throw new Error('não é FBX binário');
  const version = buf.readUInt32LE(23);
  const wide = version >= 7500;
  let offset = 27;
  const readNode = () => {
    const endOffset = wide ? Number(buf.readBigUInt64LE(offset)) : buf.readUInt32LE(offset);
    const numProps = wide ? Number(buf.readBigUInt64LE(offset + 8)) : buf.readUInt32LE(offset + 4);
    const propLen = wide ? Number(buf.readBigUInt64LE(offset + 16)) : buf.readUInt32LE(offset + 8);
    offset += wide ? 24 : 12;
    const nameLen = buf.readUInt8(offset); offset += 1;
    if (endOffset === 0) return null; // registro nulo: fim da lista
    const name = buf.toString('latin1', offset, offset + nameLen); offset += nameLen;
    const propsRaw = buf.subarray(offset, offset + propLen);
    const props = parseProps(propsRaw, numProps);
    offset += propLen;
    // Nó com lista aninhada (mesmo vazia) termina com um registro nulo.
    const nested = offset < endOffset;
    const children = [];
    while (offset < endOffset) {
      const child = readNode();
      if (!child) break;
      children.push(child);
    }
    offset = endOffset;
    return { name, numProps, propsRaw, props, children, nested };
  };
  const nodes = [];
  while (offset < buf.length - 160) {
    const node = readNode();
    if (!node) break;
    nodes.push(node);
  }
  return { version, nodes, footer: buf.subarray(offset) };
}

/** Só os valores simples (ids, nomes, tipos); arrays ficam como null. */
function parseProps(raw, count) {
  const out = [];
  let o = 0;
  for (let i = 0; i < count; i++) {
    const t = String.fromCharCode(raw[o]); o += 1;
    switch (t) {
      case 'Y': out.push(raw.readInt16LE(o)); o += 2; break;
      case 'C': out.push(!!raw[o]); o += 1; break;
      case 'I': out.push(raw.readInt32LE(o)); o += 4; break;
      case 'F': out.push(raw.readFloatLE(o)); o += 4; break;
      case 'D': out.push(raw.readDoubleLE(o)); o += 8; break;
      case 'L': out.push(raw.readBigInt64LE(o)); o += 8; break;
      case 'S': case 'R': { const n = raw.readUInt32LE(o); o += 4; out.push(t === 'S' ? raw.toString('latin1', o, o + n) : null); o += n; break; }
      case 'f': case 'd': case 'l': case 'i': case 'b': {
        const len = raw.readUInt32LE(o + 8); o += 12 + len; out.push(null); break;
      }
      default: throw new Error(`tipo de propriedade FBX desconhecido: ${t}`);
    }
  }
  return out;
}

export function writeFBX({ version, nodes, footer }) {
  const wide = version >= 7500;
  const head = wide ? 25 : 13;
  const chunks = [];
  let size = 27;
  const header = Buffer.alloc(27);
  MAGIC.copy(header, 0); header.writeUInt32LE(version, 23);
  chunks.push(header);
  const nullRecord = () => Buffer.alloc(head);
  const nodeSize = n => head + Buffer.byteLength(n.name, 'latin1') + n.propsRaw.length +
    (n.children.length || n.nested ? n.children.reduce((s, c) => s + nodeSize(c), 0) + head : 0);
  const write = n => {
    const start = size;
    const total = nodeSize(n);
    const rec = Buffer.alloc(head);
    if (wide) {
      rec.writeBigUInt64LE(BigInt(start + total), 0);
      rec.writeBigUInt64LE(BigInt(n.numProps), 8);
      rec.writeBigUInt64LE(BigInt(n.propsRaw.length), 16);
      rec.writeUInt8(Buffer.byteLength(n.name, 'latin1'), 24);
    } else {
      rec.writeUInt32LE(start + total, 0);
      rec.writeUInt32LE(n.numProps, 4);
      rec.writeUInt32LE(n.propsRaw.length, 8);
      rec.writeUInt8(Buffer.byteLength(n.name, 'latin1'), 12);
    }
    chunks.push(rec, Buffer.from(n.name, 'latin1'), n.propsRaw);
    size += head + Buffer.byteLength(n.name, 'latin1') + n.propsRaw.length;
    if (n.children.length || n.nested) {
      for (const c of n.children) write(c);
      chunks.push(nullRecord()); size += head;
    }
  };
  for (const n of nodes) write(n);
  chunks.push(nullRecord()); size += head;
  chunks.push(footer);
  return Buffer.concat(chunks);
}
