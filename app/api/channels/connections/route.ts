/**
 * Channel Connections — list + create.
 *
 * GET  /api/channels/connections?businessId=...
 *      Lista as conexões visíveis pro caller:
 *        - admin/founder: todas do business
 *        - operator+: business connections + suas próprias 'user' connections
 *
 * POST /api/channels/connections
 *      Body: { businessId, type, ownerType?, displayName?, ... }
 *      Cria uma nova conexão. Operator+ só pode criar 'user' próprio.
 *      Admin pode criar qualquer.
 *
 *      Apenas type='whatsapp_baileys' suportado pra ownerType='user'
 *      (Cloud/FB/IG sempre 'business' por limitação do Embedded Signup).
 */

import { NextRequest, NextResponse } from 'next/server';
import { adminDb } from '@/lib/config/firebaseAdmin';
import { verifyAuth, isAuthError } from '@/lib/utils/verifyAuth';
import { ROLE_HIERARCHY } from '@/lib/types';
import {
  listConnectionsForBusiness,
  createConnection,
  canUserAccessConnection,
} from '@/lib/services/channels/channelConnections';
import type {
  ChannelConnection,
  ChannelConnectionType,
  ChannelOwnerType,
  UserRole,
} from '@/lib/types';

export async function GET(req: NextRequest) {
  const businessId = req.nextUrl.searchParams.get('businessId');
  if (!businessId) {
    return NextResponse.json({ error: 'businessId required' }, { status: 400 });
  }
  const authResult = await verifyAuth(req, businessId);
  if (isAuthError(authResult)) return authResult;
  const role = (authResult.role || 'viewer') as UserRole;
  const uid = authResult.uid;
  if ((ROLE_HIERARCHY[role] || 0) < ROLE_HIERARCHY['operator']) {
    return NextResponse.json({ error: 'Forbidden — operator role required' }, { status: 403 });
  }

  try {
    const all = await listConnectionsForBusiness(businessId);
    // Filtra: admin/founder vê tudo; demais filtram conforme canUserAccessConnection
    const visible = all.filter((c) =>
      canUserAccessConnection(c, { uid, role: role as string })
    );
    // Não retorna campos sensíveis (tokens) pra UI
    const sanitized = visible.map((c) => sanitizeForClient(c));
    return NextResponse.json({ success: true, connections: sanitized });
  } catch (err) {
    console.error('[connections GET] Error:', err);
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}

interface CreateBody {
  businessId: string;
  type: ChannelConnectionType;
  ownerType?: ChannelOwnerType;
  displayName?: string;
  phoneNumber?: string;
  /** Finalidade da conexão. 'validator' cria chip Baileys SOMENTE pra
   *  checar via onWhatsApp se números têm WA antes de campanhas (nunca envia).
   *  Default 'sender'. */
  purpose?: 'sender' | 'validator';
}

export async function POST(req: NextRequest) {
  let body: CreateBody;
  try {
    body = await req.json() as CreateBody;
  } catch {
    return NextResponse.json({ error: 'Invalid body' }, { status: 400 });
  }
  const { businessId, type } = body;
  if (!businessId || !type) {
    return NextResponse.json({ error: 'businessId and type required' }, { status: 400 });
  }
  const authResult = await verifyAuth(req, businessId);
  if (isAuthError(authResult)) return authResult;
  const role = (authResult.role || 'viewer') as UserRole;
  const uid = authResult.uid;
  if ((ROLE_HIERARCHY[role] || 0) < ROLE_HIERARCHY['operator']) {
    return NextResponse.json({ error: 'Forbidden — operator role required' }, { status: 403 });
  }

  // Phase 2 escope: per-user só pra Baileys. Cloud/FB/IG continuam business-only.
  const ownerType: ChannelOwnerType = body.ownerType || 'business';
  if (ownerType === 'user' && type !== 'whatsapp_baileys') {
    return NextResponse.json({
      error: 'Apenas WhatsApp Web (Baileys) pode ter ownerType=user. Cloud/Facebook/Instagram são sempre da empresa.',
    }, { status: 400 });
  }

  // Validator chip: SOMENTE pra Baileys, SOMENTE business (compartilhado),
  // NUNCA primary. Limite de 1 por business (já checado abaixo). Esse chip
  // é o que executa onWhatsApp pra higienização de campanhas e o backend
  // do send route rejeita disparos por ele (defesa em profundidade).
  const purpose: 'sender' | 'validator' = body.purpose === 'validator' ? 'validator' : 'sender';
  if (purpose === 'validator') {
    if (type !== 'whatsapp_baileys') {
      return NextResponse.json({
        error: 'Chip validador só funciona via WhatsApp Web (Baileys).',
      }, { status: 400 });
    }
    if (ownerType !== 'business') {
      return NextResponse.json({
        error: 'Chip validador é sempre compartilhado da empresa, não pessoal.',
      }, { status: 400 });
    }
  }

  // Permissão:
  //   - business: requer admin
  //   - user: qualquer operator+ (cria pra si mesmo)
  const isAdmin = (ROLE_HIERARCHY[role as UserRole] ?? 0) >= ROLE_HIERARCHY['admin'];
  if (ownerType === 'business' && !isAdmin) {
    return NextResponse.json({ error: 'Apenas admin pode criar canais da empresa' }, { status: 403 });
  }

  // Pra ownerType='user', força ownerId = self (operator não cria pra outro)
  const ownerId = ownerType === 'user' ? uid : '';
  // Admin criando 'user' pra outro operador requer payload explícito (futuro);
  // por enquanto admin também só cria pra si mesmo via 'user'.

  // Anti-duplicate: operator não pode criar mais de uma 'user' connection do
  // mesmo type. Phase 2 escopo: 1 Baileys pessoal por usuário.
  if (ownerType === 'user') {
    const existingSnap = await adminDb.collection('channelConnections')
      .where('businessId', '==', businessId)
      .where('type', '==', type)
      .where('ownerType', '==', 'user')
      .where('ownerId', '==', uid)
      .limit(1)
      .get();
    if (!existingSnap.empty) {
      return NextResponse.json({
        error: 'Você já tem um canal pessoal deste tipo. Desconecte antes de criar outro.',
        existingConnectionId: existingSnap.docs[0].id,
      }, { status: 409 });
    }
  }

  // Phase 3.1: business pode ter múltiplas connections do mesmo type (ex: 2+
  // Baileys-empresa). isPrimary é setado APENAS na primeira. Adicionais ficam
  // isPrimary=false; admin pode promover via PATCH se quiser trocar a default.
  // Validators NUNCA viram primary (esconde de qualquer lógica que escolhe
  // "default" pra envio).
  let willBePrimary = ownerType === 'business' && purpose !== 'validator';
  if (ownerType === 'business' && purpose !== 'validator') {
    const existingPrimary = await adminDb.collection('channelConnections')
      .where('businessId', '==', businessId)
      .where('type', '==', type)
      .where('ownerType', '==', 'business')
      .where('isPrimary', '==', true)
      .limit(1)
      .get();
    if (!existingPrimary.empty) {
      // Já existe primary — esta vira secundária
      willBePrimary = false;
    }
  }

  // Validator único por business (por enquanto). Se já existe, bloqueia.
  // Limitar a 1 simplifica fluxo e evita ambiguidade de "qual validator usar".
  if (purpose === 'validator') {
    const existingValidator = await adminDb.collection('channelConnections')
      .where('businessId', '==', businessId)
      .where('purpose', '==', 'validator')
      .limit(1)
      .get();
    if (!existingValidator.empty) {
      return NextResponse.json({
        error: 'Já existe um chip validador conectado. Remova o atual antes de adicionar outro.',
        existingConnectionId: existingValidator.docs[0].id,
      }, { status: 409 });
    }
  }

  // Cloud/FB/IG: limitação do Embedded Signup permite só 1 conexão oficial
  // por business. Bloqueia tentativas de criar adicional via API.
  if (ownerType === 'business' && type !== 'whatsapp_baileys' && !willBePrimary) {
    return NextResponse.json({
      error: `${type === 'whatsapp_cloud' ? 'WhatsApp Business Cloud' : type === 'facebook' ? 'Facebook' : 'Instagram'} permite apenas 1 conexão por empresa via Embedded Signup. Desconecte a atual antes de adicionar outra.`,
    }, { status: 409 });
  }

  const now = new Date().toISOString();
  const userSnap = await adminDb.collection('users').doc(uid).get();
  const userName = (userSnap.data()?.name as string) || '';

  try {
    const defaultDisplayName = purpose === 'validator'
      ? 'Chip validador'
      : ownerType === 'user'
        ? `WhatsApp (${userName || 'Pessoal'})`
        : 'WhatsApp Web';
    const conn = await createConnection({
      businessId,
      type,
      ownerType,
      ownerId: ownerId || undefined,
      displayName: body.displayName || defaultDisplayName,
      phoneNumber: body.phoneNumber,
      isConnected: false,
      isActive: true,
      isPrimary: willBePrimary,
      ...(purpose === 'validator' ? { purpose } : {}),
      createdAt: now,
      updatedAt: now,
      createdBy: uid,
      createdByName: userName,
    });
    return NextResponse.json({ success: true, connection: sanitizeForClient(conn) });
  } catch (err) {
    console.error('[connections POST] Error:', err);
    return NextResponse.json({ error: 'Falha ao criar conexão' }, { status: 500 });
  }
}

/**
 * Remove campos sensíveis antes de devolver pro cliente. Tokens nunca saem
 * da camada server-side.
 */
function sanitizeForClient(c: ChannelConnection): Omit<ChannelConnection, 'accessToken' | 'pageAccessToken'> {
  const { accessToken: _a, pageAccessToken: _p, ...rest } = c;
  void _a; void _p;
  return rest;
}
