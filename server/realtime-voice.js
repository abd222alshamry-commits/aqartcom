const OPENAI='https://api.openai.com/v1/realtime/calls';
module.exports=function installRealtimeVoice(app,{requireAdmin}){
 const model=process.env.OPENAI_REALTIME_MODEL||'gpt-realtime';
 const voice=process.env.OPENAI_REALTIME_VOICE||'marin';
 const instructions=`أنت المدير التنفيذي الصوتي لمنصة عقارتكم. تحدث بالعربية بوضوح واختصار. هذه القناة صوتية للتحليل والاستعلام فقط. لا تدّع تنفيذ أي إجراء إداري أو مالي، ولا تعتبر أي موافقة صوتية تفويضاً لتنفيذ إجراء حساس. عند طلب تنفيذ حساس اطلب من المستخدم العودة إلى شاشة الموافقات المكتوبة.`;
 app.get('/api/admin/realtime-voice/status',requireAdmin,(req,res)=>res.json({configured:!!process.env.OPENAI_API_KEY,model,voice,transport:'webrtc'}));
 app.post('/api/admin/realtime-voice/call',requireAdmin,async(req,res)=>{
  try{
   if(!process.env.OPENAI_API_KEY)return res.status(503).json({error:'يلزم إعداد OPENAI_API_KEY'});
   const sdp=String(req.body?.sdp||''); if(!sdp.startsWith('v='))return res.status(400).json({error:'SDP غير صالح'});
   const session={type:'realtime',model,output_modalities:['audio'],instructions,max_output_tokens:900,audio:{input:{turn_detection:{type:'semantic_vad',eagerness:'medium',create_response:true,interrupt_response:true}},output:{voice,speed:1}}};
   const form=new FormData(); form.append('sdp',new Blob([sdp],{type:'application/sdp'}),'offer.sdp'); form.append('session',new Blob([JSON.stringify(session)],{type:'application/json'}),'session.json');
   const r=await fetch(OPENAI,{method:'POST',headers:{Authorization:`Bearer ${process.env.OPENAI_API_KEY}`},body:form}); const answer=await r.text();
   if(!r.ok){console.error('Realtime call',r.status,answer);return res.status(502).json({error:'تعذر إنشاء جلسة الصوت الفوري'})}
   res.type('application/sdp').send(answer);
  }catch(e){console.error('Realtime voice',e);res.status(502).json({error:'تعذر تشغيل WebRTC الصوتي'})}
 });
};
