import { NextRequest } from 'next/server';
import { adminDb } from '@/lib/config/firebaseAdmin';
import { verifyApiKey, isApiKeyError, apiError, apiSuccess } from '@/lib/middleware/apiKeyAuth';

// Valid appointment statuses
const VALID_STATUSES = new Set([
  'agendado',
  'confirmado',
  'em_andamento',
  'concluido',
  'cancelado',
  'nao_compareceu',
]);

/**
 * Calculates endTime from startTime + duration in minutes.
 * startTime format: "HH:mm"
 */
function calculateEndTime(startTime: string, durationMinutes: number): string {
  const [hours, minutes] = startTime.split(':').map(Number);
  const totalMinutes = hours * 60 + minutes + durationMinutes;
  const endHours = Math.floor(totalMinutes / 60) % 24;
  const endMinutes = totalMinutes % 60;
  return `${String(endHours).padStart(2, '0')}:${String(endMinutes).padStart(2, '0')}`;
}

// ---------------------------------------------------------------------------
// GET /api/v1/appointments
// ---------------------------------------------------------------------------
export async function GET(req: NextRequest) {
  const auth = await verifyApiKey(req, ['read:appointments']);
  if (isApiKeyError(auth)) return auth;

  try {
    const { searchParams } = req.nextUrl;
    const date = searchParams.get('date');
    const startDate = searchParams.get('startDate');
    const endDate = searchParams.get('endDate');
    const status = searchParams.get('status');
    const professionalId = searchParams.get('professionalId');
    const clientId = searchParams.get('clientId');
    const limitParam = searchParams.get('limit');
    const offsetParam = searchParams.get('offset');

    // Validate status if provided
    if (status && !VALID_STATUSES.has(status)) {
      return apiError(
        `Invalid status "${status}". Valid values: ${[...VALID_STATUSES].join(', ')}`,
        400,
      );
    }

    // Parse limit and offset
    let limit = 50;
    if (limitParam) {
      limit = Math.min(Math.max(parseInt(limitParam, 10) || 50, 1), 200);
    }
    const offset = offsetParam ? Math.max(parseInt(offsetParam, 10) || 0, 0) : 0;

    // Build query — always filtered by businessId
    let query: FirebaseFirestore.Query = adminDb
      .collection('appointments')
      .where('businessId', '==', auth.businessId);

    // Date filters
    if (date) {
      query = query.where('date', '==', date);
    } else if (startDate && endDate) {
      query = query.where('date', '>=', startDate).where('date', '<=', endDate);
    } else if (startDate) {
      query = query.where('date', '>=', startDate);
    } else if (endDate) {
      query = query.where('date', '<=', endDate);
    }

    // Additional filters
    if (status) {
      query = query.where('status', '==', status);
    }
    if (professionalId) {
      query = query.where('professionalId', '==', professionalId);
    }
    if (clientId) {
      query = query.where('clientId', '==', clientId);
    }

    // Ordering
    query = query.orderBy('date', 'asc').orderBy('startTime', 'asc');

    // Pagination
    if (offset > 0) {
      query = query.offset(offset);
    }
    query = query.limit(limit);

    const snapshot = await query.get();
    const appointments = snapshot.docs.map((doc) => ({
      id: doc.id,
      ...doc.data(),
    }));

    return apiSuccess({
      appointments,
      count: appointments.length,
      limit,
      offset,
    });
  } catch (error) {
    console.error('[API] GET /api/v1/appointments error:', error);
    return apiError('Failed to fetch appointments', 500);
  }
}

// ---------------------------------------------------------------------------
// POST /api/v1/appointments
// ---------------------------------------------------------------------------
export async function POST(req: NextRequest) {
  const auth = await verifyApiKey(req, ['write:appointments']);
  if (isApiKeyError(auth)) return auth;

  try {
    const body = await req.json();

    // Validate required fields
    const requiredFields = ['clientId', 'clientName', 'serviceName', 'date', 'startTime', 'duration', 'price'];
    const missing = requiredFields.filter((f) => body[f] === undefined || body[f] === null || body[f] === '');
    if (missing.length > 0) {
      return apiError(`Missing required fields: ${missing.join(', ')}`, 400);
    }

    // Validate date format (YYYY-MM-DD)
    if (!/^\d{4}-\d{2}-\d{2}$/.test(body.date)) {
      return apiError('Invalid date format. Expected YYYY-MM-DD', 400);
    }

    // Validate startTime format (HH:mm)
    if (!/^\d{2}:\d{2}$/.test(body.startTime)) {
      return apiError('Invalid startTime format. Expected HH:mm', 400);
    }

    // Validate duration
    const duration = Number(body.duration);
    if (isNaN(duration) || duration <= 0) {
      return apiError('Duration must be a positive number (minutes)', 400);
    }

    // Validate price
    const price = Number(body.price);
    if (isNaN(price) || price < 0) {
      return apiError('Price must be a non-negative number', 400);
    }

    // Validate status if provided
    const status = body.status || 'agendado';
    if (!VALID_STATUSES.has(status)) {
      return apiError(
        `Invalid status "${status}". Valid values: ${[...VALID_STATUSES].join(', ')}`,
        400,
      );
    }

    // Calculate endTime if not provided
    const endTime = body.endTime || calculateEndTime(body.startTime, duration);

    const now = new Date().toISOString();

    const appointmentData: Record<string, unknown> = {
      businessId: auth.businessId,
      clientId: body.clientId,
      clientName: body.clientName,
      serviceName: body.serviceName,
      date: body.date,
      startTime: body.startTime,
      endTime,
      duration,
      price,
      status,
      createdAt: now,
      updatedAt: now,
    };

    // Optional fields
    if (body.clientPhone) appointmentData.clientPhone = body.clientPhone;
    if (body.serviceId) appointmentData.serviceId = body.serviceId;
    if (body.professionalId) appointmentData.professionalId = body.professionalId;
    if (body.professionalName) appointmentData.professionalName = body.professionalName;
    if (body.notes) appointmentData.notes = body.notes;
    if (body.color) appointmentData.color = body.color;

    const docRef = await adminDb.collection('appointments').add(appointmentData);

    return apiSuccess(
      { id: docRef.id, ...appointmentData },
      201,
    );
  } catch (error) {
    console.error('[API] POST /api/v1/appointments error:', error);
    return apiError('Failed to create appointment', 500);
  }
}

// ---------------------------------------------------------------------------
// PUT /api/v1/appointments
// ---------------------------------------------------------------------------
export async function PUT(req: NextRequest) {
  const auth = await verifyApiKey(req, ['write:appointments']);
  if (isApiKeyError(auth)) return auth;

  try {
    const body = await req.json();

    if (!body.id) {
      return apiError('Missing required field: id', 400);
    }

    // Verify the appointment exists and belongs to this business
    const docRef = adminDb.collection('appointments').doc(body.id);
    const docSnap = await docRef.get();

    if (!docSnap.exists) {
      return apiError('Appointment not found', 404);
    }

    if (docSnap.data()?.businessId !== auth.businessId) {
      return apiError('Appointment not found', 404);
    }

    // Build update object with only allowed fields
    const allowedFields = [
      'clientId', 'clientName', 'clientPhone', 'serviceId', 'serviceName',
      'professionalId', 'professionalName', 'date', 'startTime', 'endTime',
      'duration', 'status', 'price', 'notes', 'color',
    ];

    const updateData: Record<string, unknown> = {};
    for (const field of allowedFields) {
      if (body[field] !== undefined) {
        updateData[field] = body[field];
      }
    }

    if (Object.keys(updateData).length === 0) {
      return apiError('No valid fields to update', 400);
    }

    // Validate status if provided
    if (updateData.status && !VALID_STATUSES.has(updateData.status as string)) {
      return apiError(
        `Invalid status "${updateData.status}". Valid values: ${[...VALID_STATUSES].join(', ')}`,
        400,
      );
    }

    // Validate date format if provided
    if (updateData.date && !/^\d{4}-\d{2}-\d{2}$/.test(updateData.date as string)) {
      return apiError('Invalid date format. Expected YYYY-MM-DD', 400);
    }

    // Validate startTime format if provided
    if (updateData.startTime && !/^\d{2}:\d{2}$/.test(updateData.startTime as string)) {
      return apiError('Invalid startTime format. Expected HH:mm', 400);
    }

    // Validate duration if provided
    if (updateData.duration !== undefined) {
      const duration = Number(updateData.duration);
      if (isNaN(duration) || duration <= 0) {
        return apiError('Duration must be a positive number (minutes)', 400);
      }
      updateData.duration = duration;
    }

    // Validate price if provided
    if (updateData.price !== undefined) {
      const price = Number(updateData.price);
      if (isNaN(price) || price < 0) {
        return apiError('Price must be a non-negative number', 400);
      }
      updateData.price = price;
    }

    // Recalculate endTime if startTime or duration changed but endTime wasn't explicitly set
    if ((updateData.startTime || updateData.duration) && !updateData.endTime) {
      const existingData = docSnap.data()!;
      const startTime = (updateData.startTime as string) || existingData.startTime;
      const duration = (updateData.duration as number) || existingData.duration;
      updateData.endTime = calculateEndTime(startTime, duration);
    }

    updateData.updatedAt = new Date().toISOString();

    await docRef.update(updateData);

    const updated = await docRef.get();

    return apiSuccess({ id: updated.id, ...updated.data() });
  } catch (error) {
    console.error('[API] PUT /api/v1/appointments error:', error);
    return apiError('Failed to update appointment', 500);
  }
}

// ---------------------------------------------------------------------------
// DELETE /api/v1/appointments
// ---------------------------------------------------------------------------
export async function DELETE(req: NextRequest) {
  const auth = await verifyApiKey(req, ['write:appointments']);
  if (isApiKeyError(auth)) return auth;

  try {
    const id = req.nextUrl.searchParams.get('id');

    if (!id) {
      return apiError('Missing required query parameter: id', 400);
    }

    const docRef = adminDb.collection('appointments').doc(id);
    const docSnap = await docRef.get();

    if (!docSnap.exists) {
      return apiError('Appointment not found', 404);
    }

    if (docSnap.data()?.businessId !== auth.businessId) {
      return apiError('Appointment not found', 404);
    }

    await docRef.delete();

    return apiSuccess({ id, deleted: true });
  } catch (error) {
    console.error('[API] DELETE /api/v1/appointments error:', error);
    return apiError('Failed to delete appointment', 500);
  }
}
