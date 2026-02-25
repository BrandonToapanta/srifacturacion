<?php
$db = mysqli_init();
$db->real_connect("127.0.0.1","root","disisot4567","websegura");

function is_valid_domain_name($domain_name)
{
    return (preg_match("/^([a-z\d](-*[a-z\d])*)(\.([a-z\d](-*[a-z\d])*))*$/i", $domain_name) //valid chars check
            && preg_match("/^.{1,253}$/", $domain_name) //overall length check
            && preg_match("/^[^\.]{1,63}(\.[^\.]{1,63})*$/", $domain_name)   ); //length of each label
}


$query = "SELECT * FROM DB_LISTA_NEGRA WHERE validado = 0";

if ($result = $db->query($query)) {
$i = 0;
    /* fetch object array */
    while ($row = $result->fetch_row()) {
        printf ("%s (%s)\n", $row[0], $row[1]);
    $i++;
       if(checkdnsrr($row[1],"A")){
        echo "válido\n";
      if (!$db->query("update db_lista_negra set validado=1, habilitado=1, fecha_validacion = NOW()  where id=".$row[0])){ 
    printf("Errormessage: %s\n", $db->error);
       }
      }else{
        echo "inválido\n";
      if (!$db->query("update db_lista_negra set validado=1, habilitado=0, fecha_validacion = NOW() where id=".$row[0])){
    printf("Errormessage: %s\n", $db->error);
      } 
       }
    if ($i==1000){
    sleep(2);
    $i=0;
    } 
    }

    /* free result set */
    $result->close();
} else {
printf("Errormessage: %s\n", $db->error);
}


?>
