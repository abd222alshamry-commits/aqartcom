let hotelRequest = 0;
async function showHotelDetails(id) {
  const request = ++hotelRequest, body = $('modalBody');
  $('modal').classList.remove('hidden'); document.body.classList.add('hotel-dialog-open');
  body.innerHTML = '<p role="status">جارٍ تحميل الإقامة والصور والفيديوهات…</p>'; $('close').focus();
  try {
    const response = await fetch('/api/hotels/' + encodeURIComponent(id)), result = await response.json();
    if (request !== hotelRequest) return;
    if (!response.ok || !result.hotel) throw Error(result.error || 'تعذر تحميل الإقامة');
    const hotel = result.hotel, rooms = Array.isArray(result.rooms) ? result.rooms : [];
    selectedHotel = hotel;
    body.innerHTML = `<h2>${esc(hotel.name)}</h2>
      <div data-listing-kind="hotel" data-listing-id="${esc(id)}" data-title="${esc(hotel.name)}"></div>
      <section id="hotelMedia"></section><p>📍 ${esc(hotel.city)} ${esc(hotel.district || '')}</p>
      <p>${esc(hotel.description || '')}</p><h3>شروط الإقامة والتأجير</h3>
      <p style="white-space:pre-wrap">${esc(hotel.rental_terms || 'لم يضف المالك شروطًا خاصة بعد')}</p>
      <p>الدخول ${esc(hotel.check_in_time || '14:00')} — الخروج ${esc(hotel.check_out_time || '12:00')} بتوقيت دمشق. الإلغاء المجاني حتى ${Number(hotel.free_cancel_hours ?? 24)} ساعة قبل الدخول.</p>
      <p>${esc(hotel.cancellation_policy || '')}</p><h3>الغرف والوحدات المتاحة</h3>
      <div class="rooms">${rooms.map(room => `<div class="room"><div class="room-content"><b>${esc(room.name)}</b>
        <div>${esc(room.room_type)} · ${Number(room.max_guests)} ضيوف · ${esc(room.size_m2 || '-')} م²</div>
        <strong>${Number(room.price).toLocaleString()} ${esc(room.currency)} / ليلة</strong>
        <div data-room-media="${esc(room.id)}"></div></div>
        <button class="room-book" onclick="bookingForm(${Number(id)},${Number(room.id)})">احجز</button></div>`).join('') || '<p>لا توجد وحدات منشورة حاليًا.</p>'}</div>
      <section id="stayReviews" data-hotel="${esc(id)}"><h3>تقييمات الضيوف</h3><p>جارٍ تحميل التقييمات…</p></section>`;
    const media = [...MediaGallery.items(hotel, hotel.name), ...rooms.flatMap(room => MediaGallery.items(room, 'الغرفة: ' + room.name))];
    MediaGallery.mount($('hotelMedia'), media, 'صور وفيديوهات المنشأة والوحدات');
    body.querySelectorAll('[data-room-media]').forEach(host => {
      const room = rooms.find(room => String(room.id) === host.dataset.roomMedia);
      MediaGallery.mount(host, MediaGallery.items(room, 'الغرفة: ' + room.name), 'صور وفيديوهات الغرفة');
    });
    loadPublicReviews(id);
  } catch (error) {
    if (request !== hotelRequest) return;
    body.innerHTML = '<p role="alert">' + esc(error.message || 'تعذر الاتصال بالمنشأة') + '</p><button type="button" id="retryHotel">إعادة المحاولة</button>';
    $('retryHotel').onclick = () => showHotelDetails(id);
  }
}
function closeHotelDetails() {
  hotelRequest++; $('modal').classList.add('hidden'); document.body.classList.remove('hotel-dialog-open');
}
document.addEventListener('DOMContentLoaded', () => {
  $('modal').addEventListener('click', event => { if (event.target === $('modal')) closeHotelDetails(); });
  document.addEventListener('keydown', event => {
    if (event.key === 'Escape' && !event.defaultPrevented && !document.querySelector('.media-image-viewer,.property-video-viewer')) closeHotelDetails();
  });
});
