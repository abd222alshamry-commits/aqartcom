/* Location names: OpenSyria Data Geography, CC BY 4.0; see GEOGRAPHY-SOURCES.md. */
(function () {
  let sequence=0;
  function bind(city, town) {
    if(!city||!town||city.dataset.locationBound)return;
    city.dataset.locationBound='true';
    const data=window.SYRIA_LOCATIONS;
    const originalCity=city.value, originalTown=town.value;
    let governorate=city;
    if(city.tagName!=='SELECT') {
      governorate=document.createElement('select');
      governorate.name=city.name; governorate.id=city.id; governorate.required=city.required;
      governorate.dataset.locationBound='true'; city.replaceWith(governorate);
    }
    governorate.setAttribute('aria-label','المحافظة');
    governorate.replaceChildren(new Option('اختر المحافظة',''));
    for(const name of data.governorates)governorate.add(new Option(name,name));
    if(originalCity&&!data.governorates.includes(originalCity))governorate.add(new Option(originalCity+' (قيمة محفوظة)',originalCity));
    governorate.value=originalCity;
    town.setAttribute('aria-label','المدينة / البلدة / القرية أو الحي');
    town.placeholder='اكتب لاختيار بلدة أو أدخل موقعًا آخر';
    town.autocomplete='off'; town.maxLength=120;
    const list=document.createElement('datalist');list.id='localities-'+(++sequence);
    town.setAttribute('list',list.id);town.after(list);
    function refresh(clear) {
      if(clear)town.value='';
      town.disabled=!governorate.value;
      list.replaceChildren(...(data.townsByGovernorate[governorate.value]||[]).map(name=>new Option(name,name)));
    }
    governorate.addEventListener('change',()=>refresh(true));
    refresh(false);town.value=originalTown;
  }
  window.bindSyriaLocations=function(root) {
    bind(root.querySelector('#city'),root.querySelector('#district'));
    for(const form of root.querySelectorAll('form'))bind(form.querySelector('[name="city"]'),form.querySelector('[name="district"]'));
  };
})();
