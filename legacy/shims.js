// ES3 helpers for IE8. No network, external files, shell or registry access.
if(!String.prototype.normalize){String.prototype.normalize=function(){var umlauts={'a':'ä','o':'ö','u':'ü','A':'Ä','O':'Ö','U':'Ü'};return String(this).replace(/([aouAOU])\u0308/g,function(all,c){return umlauts[c];}).replace(/ß/g,'SS');};}
