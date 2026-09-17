'use strict';
function snapshot(h){return {lodging_type:h.lodging_type||'hotel',rental_terms:h.rental_terms||'',cancellation_policy:h.cancellation_policy||'',free_cancel_hours:Number(h.free_cancel_hours??24),check_in_time:/^([01]\d|2[0-3]):[0-5]\d$/.test(h.check_in_time)?h.check_in_time:'14:00',check_out_time:/^([01]\d|2[0-3]):[0-5]\d$/.test(h.check_out_time)?h.check_out_time:'12:00',version:Number(h.terms_version||1)};}
function description(h){const p=snapshot(h);return [`الإلغاء المجاني متاح حتى ${p.free_cancel_hours} ساعة قبل موعد الدخول بتوقيت دمشق.`,p.cancellation_policy,p.rental_terms&&'شروط الإقامة: '+p.rental_terms].filter(Boolean).join('\n');}
module.exports={snapshot,description};
