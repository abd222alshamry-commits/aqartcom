(async()=>{
 const status=document.getElementById('detailStatus'),share=document.getElementById('shareListing');
 try{
  const id=new URLSearchParams(location.search).get('id');if(!/^\d+$/.test(id||''))throw Error('الإعلان غير موجود');
  const response=await fetch('/api/market/listings/'+id),json=await response.json();
  if(!response.ok)throw Error(json.error||'تعذر تحميل الإعلان');
  document.title=json.data.title+' — عقارتكم';document.getElementById('officeProperty').innerHTML=officeListingCard(json.data);
  status.textContent='';document.getElementById('officeDetailNote').hidden=false;share.hidden=false;
  share.onclick=async()=>{try{if(navigator.share)await navigator.share({title:json.data.title,url:location.href});else{await navigator.clipboard.writeText(location.href);status.textContent='تم نسخ رابط الإعلان';}}catch(error){if(error.name!=='AbortError')status.textContent='يمكنك نسخ رابط الإعلان من شريط العنوان.';}};
 }catch(error){status.textContent=error.message;}
})();
