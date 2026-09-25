import { IsString, MaxLength } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class CreateOperatorDto {
  @ApiProperty({ example: 'Shyamoli Paribahan' })
  @IsString()
  @MaxLength(150)
  name: string;
}
