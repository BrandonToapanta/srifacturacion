<?php

$db = mysqli_init();
$db->real_connect("127.0.0.1","root","disisot4567","websegura");

function strposa($haystack, $needle, $offset=0) {
    if(!is_array($needle)) $needle = array($needle);
    foreach($needle as $query) {
        if(strpos($haystack, $query, $offset) !== false) return true; // stop on first true result
    }
    return false;
}
$array  = 
array(
'schema', 
'youtube',
'google',
'wikipedia', 
'.gov',
'.gob'
);

function get_domain($url = SITE_URL)
{
    preg_match("/[a-z0-9\-]{1,63}\.[a-z\.]{2,6}$/", parse_url($url, PHP_URL_HOST), $_domain_tld);
    return $_domain_tld[0];
}

function extraerURLs($cadena){
    $regex = '/https?\:\/\/[^\" ]+/i';
    preg_match_all($regex, $cadena, $partes);
    return ($partes[0]);
}


$list = array(
// "porn",
// "hentai",
"xxx",
// "cholo+porno"
// "porno+cholas"
// "porno+latino"
);

foreach ($list as $value) {
    echo "$value ok
";

$j=0;
for ($i = 0; $i < 130; $i=$i+10){ 
$cadena = file_get_contents('http://www.google.com.ec/search?q='.$value.'&start='.$i);

// Llamamos a la función y le pasamos la cadena a buscar
$urls = extraerURLs($cadena);
 
// Listamos los resultados
foreach($urls as $url){
// extraemos dominio
if (strposa($url,$array)===false){
if (!$db->query("insert into db_lista_negra (dns, categoria, idepol, validado, habilitado) values ('".get_domain($url)."', '9','1','0','1')")) {
    printf("Errormessage: %s\n", $db->error);
}
echo $j.' '.$i.' '.get_domain($url).'
';
$j++;
}
}
sleep(10);
}
}
?>
