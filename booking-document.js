'use strict';
// Android 1.7+ already provides the native print/save-as-PDF action.
if(/AqartkomNative\/(\d+)/.test(navigator.userAgent)&&Number(RegExp.$1)>=170){
 const link=document.getElementById('downloadBookingDocument');
 if(link){link.href='aqartkom-app://print';link.removeAttribute('download');link.textContent='حفظ PDF أو طباعة';}
 const hint=document.getElementById('documentHint');
 if(hint)hint.textContent='اضغط «حفظ PDF أو طباعة»، ثم اختر «حفظ بتنسيق PDF» وحدد مكان الحفظ على هاتفك.';
}
