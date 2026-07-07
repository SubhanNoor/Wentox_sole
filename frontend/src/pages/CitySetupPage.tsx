import { useState } from 'react';
import { useApp } from '@/context/AppContext';
import AppLayout from '@/components/AppLayout';
import { Plus, Save, MapPin } from 'lucide-react';

export default function CitySetupPage() {
  const { state, dispatch } = useApp();

  const [cityName, setCityName] = useState('');
  const [successMsg, setSuccessMsg] = useState('');

  const handleAddCity = (e: React.FormEvent) => {
    e.preventDefault();
    if (!cityName.trim()) return;

    const newCity = {
      id: 'ct_' + Date.now(),
      name: cityName.trim()
    };

    dispatch({ type: 'ADD_CITY', city: newCity });
    setCityName('');
    setSuccessMsg('City added successfully.');
    setTimeout(() => setSuccessMsg(''), 3000);
  };

  return (
    <AppLayout pageTitle="City Setup">
      <div className="mx-auto" style={{ maxWidth: 800 }}>
        
        {successMsg && (
          <div className="banner-success rounded-lg px-4 py-3 text-sm mb-4">{successMsg}</div>
        )}

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          
          {/* Add City Form */}
          <div className="card-white p-5 bg-white border">
            <h3 className="font-lora font-semibold text-lg border-b pb-2 mb-4 text-slate-800 flex items-center gap-2">
              <Plus size={18} className="text-amber-600" /> Create New City
            </h3>
            
            <form onSubmit={handleAddCity} className="flex flex-col gap-3">
              <div>
                <label className="block text-xs font-semibold text-slate-600 mb-1">City Name</label>
                <input
                  type="text"
                  value={cityName}
                  onChange={e => setCityName(e.target.value)}
                  placeholder="e.g. Faisalabad, Rawalpindi"
                  className="soleria-input"
                />
              </div>
              <button type="submit" className="btn-gold w-full mt-2 flex items-center justify-center gap-1">
                <Save size={14} /> Save City
              </button>
            </form>
          </div>

          {/* Cities List */}
          <div className="card-white p-5 bg-white border">
            <h3 className="font-lora font-semibold text-lg border-b pb-2 mb-4 text-slate-800 flex items-center gap-2">
              <MapPin size={18} className="text-slate-600" /> Active Cities
            </h3>
            
            <div className="grid grid-cols-2 gap-2 max-h-[50vh] overflow-y-auto pr-1">
              {state.cities.map(city => (
                <div key={city.id} className="p-3 rounded-lg border border-slate-200 text-sm font-semibold text-slate-700 bg-slate-50/50">
                  {city.name}
                  <span className="block font-mono text-[9px] text-slate-400 font-normal mt-0.5">Code: {city.id}</span>
                </div>
              ))}
            </div>
          </div>

        </div>

      </div>
    </AppLayout>
  );
}
