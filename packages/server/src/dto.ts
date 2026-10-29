import type { Gate, Notification, User, Villa, Visitor } from '@vms/db';
import {
  isDocumentExpiredAt,
  maskDocumentNumber,
  maskPhone,
  type GateDTO,
  type NotificationDTO,
  type NotificationType,
  type StaffUserDTO,
  type VillaDTO,
  type VisitorFullDTO,
  type VisitorRefDTO,
  type VisitorSelfDTO,
  type VisitorSummaryDTO,
} from '@vms/shared';

export const iso = (d: Date | null | undefined): string | null => (d ? d.toISOString() : null);

export function toStaffUserDTO(u: User): StaffUserDTO {
  return {
    id: u.id,
    username: u.username,
    fullName: u.fullName,
    role: u.role,
    isActive: u.isActive,
    phone: u.phone,
    mustChangePassword: u.mustChangePassword,
    locale: u.locale,
    lastLoginAt: iso(u.lastLoginAt),
    createdAt: u.createdAt.toISOString(),
  };
}

export function toVisitorRefDTO(v: Visitor, now: Date, tz: string): VisitorRefDTO {
  return {
    id: v.id,
    fullName: v.fullName,
    documentType: v.documentType,
    documentNumberMasked: maskDocumentNumber(v.documentNumber),
    nationality: v.nationality,
    mobileMasked: maskPhone(v.mobile),
    documentExpiryDate: v.documentExpiryDate,
    documentExpired: isDocumentExpiredAt(v.documentExpiryDate, now, tz),
  };
}

export function toVisitorSelfDTO(v: Visitor, now: Date, tz: string): VisitorSelfDTO {
  return {
    ...toVisitorRefDTO(v, now, tz),
    documentExpiryCalendar: v.documentExpiryCalendar,
    documentExpiryOriginal: v.documentExpiryOriginal,
    version: v.version,
    locale: v.locale,
  };
}

export interface VisitorStats {
  visitCount: number;
  lastVisitAt: Date | null;
  hasOpenVisit?: boolean;
}

export function toVisitorSummaryDTO(v: Visitor, stats: VisitorStats, now: Date, tz: string): VisitorSummaryDTO {
  return { ...toVisitorRefDTO(v, now, tz), visitCount: stats.visitCount, lastVisitAt: iso(stats.lastVisitAt) };
}

export function toVisitorFullDTO(v: Visitor, stats: VisitorStats, now: Date, tz: string): VisitorFullDTO {
  return {
    ...toVisitorSummaryDTO(v, stats, now, tz),
    documentNumber: v.documentNumber,
    mobile: v.mobile,
    documentExpiryCalendar: v.documentExpiryCalendar,
    documentExpiryOriginal: v.documentExpiryOriginal,
    version: v.version,
    createdVia: v.createdVia === 'self' ? 'self' : 'staff',
    createdAt: v.createdAt.toISOString(),
    updatedAt: v.updatedAt.toISOString(),
    hasOpenVisit: stats.hasOpenVisit ?? false,
  };
}

export function toGateDTO(g: Gate): GateDTO {
  return {
    id: g.id,
    code: g.code,
    nameAr: g.nameAr,
    nameEn: g.nameEn,
    supportsEntry: g.supportsEntry,
    supportsExit: g.supportsExit,
    isActive: g.isActive,
  };
}

export function toVillaDTO(v: Villa): VillaDTO {
  return { id: v.id, number: v.number, label: v.label, isActive: v.isActive };
}

export function toNotificationDTO(n: Notification): NotificationDTO {
  return {
    id: n.id,
    type: n.type as NotificationType,
    params: n.params,
    visitId: n.visitId,
    readAt: iso(n.readAt),
    createdAt: n.createdAt.toISOString(),
  };
}

export function paginate<T>(items: T[], total: number, page: number, pageSize: number) {
  return { items, page, pageSize, total, totalPages: Math.max(1, Math.ceil(total / pageSize)) };
}
